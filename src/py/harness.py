import ast
import builtins
import contextlib
import copy
import io
import json
import sys
import time
import traceback

_FILE = "solution.py"
_MAX_OUT = 20000


class _Timeout(BaseException):
    """Raised by the trace guard. BaseException, so `except Exception` in user code cannot swallow it."""


def _no_input(*args, **kwargs):
    raise RuntimeError("input() is not available here. Use the function's parameters instead.")


def _user_line(exc):
    if isinstance(exc, SyntaxError) and exc.filename == _FILE:
        return exc.lineno
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == _FILE:
            line = frame.lineno
    return line


def _format_exc(exc):
    if isinstance(exc, _Timeout):
        return "TimeoutError: the code ran longer than the time limit (infinite loop?)"
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == _FILE]
    head = ""
    if frames:
        head = "Traceback (most recent call last):\n" + "".join(traceback.format_list(frames))
    return head + "".join(traceback.format_exception_only(type(exc), exc)).rstrip()


def _clip(text):
    return text if len(text) <= _MAX_OUT else text[:_MAX_OUT] + "\n... output truncated ..."


def _short_repr(value, limit=300):
    try:
        text = repr(value)
    except Exception as exc:
        text = "<repr failed: %s>" % exc
    return text if len(text) <= limit else text[:limit] + "..."


def codinghost_run(code, function_name, tests_json, time_limit=0):
    """Run user code, then call function_name for each test. Returns a JSON string.

    time_limit > 0 installs a sys.settrace guard (used when Python runs on the main
    thread). In a worker the page enforces the limit by terminating the worker.
    """
    tests = json.loads(tests_json)
    out, err = io.StringIO(), io.StringIO()
    result = {"stdout": "", "stderr": "", "error": None, "error_line": None, "timed_out": False, "results": []}
    ns = {"__name__": "__main__", "__builtins__": builtins, "input": _no_input}

    if time_limit and time_limit > 0:
        deadline = time.monotonic() + time_limit

        def guard(frame, event, arg):
            if time.monotonic() > deadline:
                raise _Timeout()
            return guard

        sys.settrace(guard)
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                exec(compile(code, _FILE, "exec"), ns)
            except _Timeout as exc:
                result["error"] = _format_exc(exc)
                result["timed_out"] = True
            except BaseException as exc:
                result["error"] = _format_exc(exc)
                result["error_line"] = _user_line(exc)

            fn = ns.get(function_name)
            if result["error"] is None and not callable(fn):
                result["error"] = "NameError: define a function named '%s'" % function_name

            if result["error"] is None:
                for index, test in enumerate(tests):
                    item = {
                        "index": index,
                        "hidden": bool(test.get("hidden")),
                        "args": test.get("args_py", ""),
                        "expected": test.get("expected_py", ""),
                        "actual": None,
                        "status": "pass",
                        "message": None,
                        "line": None,
                    }
                    try:
                        args = ast.literal_eval(test["args_py"])
                        if not isinstance(args, tuple):
                            args = (args,)
                        expected = ast.literal_eval(test["expected_py"])
                    except Exception as exc:
                        item["status"] = "invalid"
                        item["message"] = "Bad test definition: %s" % exc
                        result["results"].append(item)
                        continue
                    try:
                        actual = fn(*copy.deepcopy(args))
                    except _Timeout as exc:
                        item["status"] = "error"
                        item["message"] = _format_exc(exc)
                        result["results"].append(item)
                        result["timed_out"] = True
                        break
                    except BaseException as exc:
                        item["status"] = "error"
                        item["message"] = _format_exc(exc)
                        item["line"] = _user_line(exc)
                    else:
                        item["actual"] = _short_repr(actual)
                        try:
                            same = bool(actual == expected)
                        except Exception:
                            same = False
                        if not same:
                            item["status"] = "fail"
                    result["results"].append(item)
    finally:
        sys.settrace(None)

    result["stdout"] = _clip(out.getvalue())
    result["stderr"] = _clip(err.getvalue())
    if result["timed_out"] and result["error"] is None:
        result["error"] = "TimeoutError: the code ran longer than the time limit (infinite loop?)"
    return json.dumps(result)
