var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var _a, _b, _c, _d, _e;
import path from "path";
import { fileURLToPath } from "url";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
function _mergeNamespaces(n, m) {
  for (var i = 0; i < m.length; i++) {
    const e = m[i];
    if (typeof e !== "string" && !Array.isArray(e)) {
      for (const k in e) {
        if (k !== "default" && !(k in n)) {
          const d = Object.getOwnPropertyDescriptor(e, k);
          if (d) {
            Object.defineProperty(n, k, d.get ? d : {
              enumerable: true,
              get: /* @__PURE__ */ __name(() => e[k], "get")
            });
          }
        }
      }
    }
  }
  return Object.freeze(Object.defineProperty(n, Symbol.toStringTag, { value: "Module" }));
}
__name(_mergeNamespaces, "_mergeNamespaces");
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
__name(getDefaultExportFromCjs, "getDefaultExportFromCjs");
var react = { exports: {} };
var react_production = {};
/**
 * @license React
 * react.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var hasRequiredReact_production;
function requireReact_production() {
  if (hasRequiredReact_production) return react_production;
  hasRequiredReact_production = 1;
  var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = Symbol.for("react.profiler"), REACT_CONSUMER_TYPE = Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"), REACT_MEMO_TYPE = Symbol.for("react.memo"), REACT_LAZY_TYPE = Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = Symbol.for("react.activity"), MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
  function getIteratorFn(maybeIterable) {
    if (null === maybeIterable || "object" !== typeof maybeIterable) return null;
    maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
    return "function" === typeof maybeIterable ? maybeIterable : null;
  }
  __name(getIteratorFn, "getIteratorFn");
  var ReactNoopUpdateQueue = {
    isMounted: /* @__PURE__ */ __name(function() {
      return false;
    }, "isMounted"),
    enqueueForceUpdate: /* @__PURE__ */ __name(function() {
    }, "enqueueForceUpdate"),
    enqueueReplaceState: /* @__PURE__ */ __name(function() {
    }, "enqueueReplaceState"),
    enqueueSetState: /* @__PURE__ */ __name(function() {
    }, "enqueueSetState")
  }, assign = Object.assign, emptyObject = {};
  function Component(props, context, updater) {
    this.props = props;
    this.context = context;
    this.refs = emptyObject;
    this.updater = updater || ReactNoopUpdateQueue;
  }
  __name(Component, "Component");
  Component.prototype.isReactComponent = {};
  Component.prototype.setState = function(partialState, callback) {
    if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
      throw Error(
        "takes an object of state variables to update or a function which returns an object of state variables."
      );
    this.updater.enqueueSetState(this, partialState, callback, "setState");
  };
  Component.prototype.forceUpdate = function(callback) {
    this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
  };
  function ComponentDummy() {
  }
  __name(ComponentDummy, "ComponentDummy");
  ComponentDummy.prototype = Component.prototype;
  function PureComponent(props, context, updater) {
    this.props = props;
    this.context = context;
    this.refs = emptyObject;
    this.updater = updater || ReactNoopUpdateQueue;
  }
  __name(PureComponent, "PureComponent");
  var pureComponentPrototype = PureComponent.prototype = new ComponentDummy();
  pureComponentPrototype.constructor = PureComponent;
  assign(pureComponentPrototype, Component.prototype);
  pureComponentPrototype.isPureReactComponent = true;
  var isArrayImpl = Array.isArray;
  function noop() {
  }
  __name(noop, "noop");
  var ReactSharedInternals = { H: null, A: null, T: null, S: null }, hasOwnProperty = Object.prototype.hasOwnProperty;
  function ReactElement(type, key, props) {
    var refProp = props.ref;
    return {
      $$typeof: REACT_ELEMENT_TYPE,
      type,
      key,
      ref: void 0 !== refProp ? refProp : null,
      props
    };
  }
  __name(ReactElement, "ReactElement");
  function cloneAndReplaceKey(oldElement, newKey) {
    return ReactElement(oldElement.type, newKey, oldElement.props);
  }
  __name(cloneAndReplaceKey, "cloneAndReplaceKey");
  function isValidElement(object) {
    return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
  }
  __name(isValidElement, "isValidElement");
  function escape(key) {
    var escaperLookup = { "=": "=0", ":": "=2" };
    return "$" + key.replace(/[=:]/g, function(match) {
      return escaperLookup[match];
    });
  }
  __name(escape, "escape");
  var userProvidedKeyEscapeRegex = /\/+/g;
  function getElementKey(element, index2) {
    return "object" === typeof element && null !== element && null != element.key ? escape("" + element.key) : index2.toString(36);
  }
  __name(getElementKey, "getElementKey");
  function resolveThenable(thenable) {
    switch (thenable.status) {
      case "fulfilled":
        return thenable.value;
      case "rejected":
        throw thenable.reason;
      default:
        switch ("string" === typeof thenable.status ? thenable.then(noop, noop) : (thenable.status = "pending", thenable.then(
          function(fulfilledValue) {
            "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
          },
          function(error) {
            "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
          }
        )), thenable.status) {
          case "fulfilled":
            return thenable.value;
          case "rejected":
            throw thenable.reason;
        }
    }
    throw thenable;
  }
  __name(resolveThenable, "resolveThenable");
  function mapIntoArray(children, array2, escapedPrefix, nameSoFar, callback) {
    var type = typeof children;
    if ("undefined" === type || "boolean" === type) children = null;
    var invokeCallback = false;
    if (null === children) invokeCallback = true;
    else
      switch (type) {
        case "bigint":
        case "string":
        case "number":
          invokeCallback = true;
          break;
        case "object":
          switch (children.$$typeof) {
            case REACT_ELEMENT_TYPE:
            case REACT_PORTAL_TYPE:
              invokeCallback = true;
              break;
            case REACT_LAZY_TYPE:
              return invokeCallback = children._init, mapIntoArray(
                invokeCallback(children._payload),
                array2,
                escapedPrefix,
                nameSoFar,
                callback
              );
          }
      }
    if (invokeCallback)
      return callback = callback(children), invokeCallback = "" === nameSoFar ? "." + getElementKey(children, 0) : nameSoFar, isArrayImpl(callback) ? (escapedPrefix = "", null != invokeCallback && (escapedPrefix = invokeCallback.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array2, escapedPrefix, "", function(c) {
        return c;
      })) : null != callback && (isValidElement(callback) && (callback = cloneAndReplaceKey(
        callback,
        escapedPrefix + (null == callback.key || children && children.key === callback.key ? "" : ("" + callback.key).replace(
          userProvidedKeyEscapeRegex,
          "$&/"
        ) + "/") + invokeCallback
      )), array2.push(callback)), 1;
    invokeCallback = 0;
    var nextNamePrefix = "" === nameSoFar ? "." : nameSoFar + ":";
    if (isArrayImpl(children))
      for (var i = 0; i < children.length; i++)
        nameSoFar = children[i], type = nextNamePrefix + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
          nameSoFar,
          array2,
          escapedPrefix,
          type,
          callback
        );
    else if (i = getIteratorFn(children), "function" === typeof i)
      for (children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
        nameSoFar = nameSoFar.value, type = nextNamePrefix + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
          nameSoFar,
          array2,
          escapedPrefix,
          type,
          callback
        );
    else if ("object" === type) {
      if ("function" === typeof children.then)
        return mapIntoArray(
          resolveThenable(children),
          array2,
          escapedPrefix,
          nameSoFar,
          callback
        );
      array2 = String(children);
      throw Error(
        "Objects are not valid as a React child (found: " + ("[object Object]" === array2 ? "object with keys {" + Object.keys(children).join(", ") + "}" : array2) + "). If you meant to render a collection of children, use an array instead."
      );
    }
    return invokeCallback;
  }
  __name(mapIntoArray, "mapIntoArray");
  function mapChildren(children, func, context) {
    if (null == children) return children;
    var result = [], count = 0;
    mapIntoArray(children, result, "", "", function(child) {
      return func.call(context, child, count++);
    });
    return result;
  }
  __name(mapChildren, "mapChildren");
  function lazyInitializer(payload) {
    if (-1 === payload._status) {
      var ctor = payload._result;
      ctor = ctor();
      ctor.then(
        function(moduleObject) {
          if (0 === payload._status || -1 === payload._status)
            payload._status = 1, payload._result = moduleObject;
        },
        function(error) {
          if (0 === payload._status || -1 === payload._status)
            payload._status = 2, payload._result = error;
        }
      );
      -1 === payload._status && (payload._status = 0, payload._result = ctor);
    }
    if (1 === payload._status) return payload._result.default;
    throw payload._result;
  }
  __name(lazyInitializer, "lazyInitializer");
  var reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
    if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
      var event = new window.ErrorEvent("error", {
        bubbles: true,
        cancelable: true,
        message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
        error
      });
      if (!window.dispatchEvent(event)) return;
    } else if ("object" === typeof process && "function" === typeof process.emit) {
      process.emit("uncaughtException", error);
      return;
    }
    console.error(error);
  }, Children = {
    map: mapChildren,
    forEach: /* @__PURE__ */ __name(function(children, forEachFunc, forEachContext) {
      mapChildren(
        children,
        function() {
          forEachFunc.apply(this, arguments);
        },
        forEachContext
      );
    }, "forEach"),
    count: /* @__PURE__ */ __name(function(children) {
      var n = 0;
      mapChildren(children, function() {
        n++;
      });
      return n;
    }, "count"),
    toArray: /* @__PURE__ */ __name(function(children) {
      return mapChildren(children, function(child) {
        return child;
      }) || [];
    }, "toArray"),
    only: /* @__PURE__ */ __name(function(children) {
      if (!isValidElement(children))
        throw Error(
          "React.Children.only expected to receive a single React element child."
        );
      return children;
    }, "only")
  };
  react_production.Activity = REACT_ACTIVITY_TYPE;
  react_production.Children = Children;
  react_production.Component = Component;
  react_production.Fragment = REACT_FRAGMENT_TYPE;
  react_production.Profiler = REACT_PROFILER_TYPE;
  react_production.PureComponent = PureComponent;
  react_production.StrictMode = REACT_STRICT_MODE_TYPE;
  react_production.Suspense = REACT_SUSPENSE_TYPE;
  react_production.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
  react_production.__COMPILER_RUNTIME = {
    __proto__: null,
    c: /* @__PURE__ */ __name(function(size) {
      return ReactSharedInternals.H.useMemoCache(size);
    }, "c")
  };
  react_production.cache = function(fn) {
    return function() {
      return fn.apply(null, arguments);
    };
  };
  react_production.cacheSignal = function() {
    return null;
  };
  react_production.cloneElement = function(element, config2, children) {
    if (null === element || void 0 === element)
      throw Error(
        "The argument must be a React element, but you passed " + element + "."
      );
    var props = assign({}, element.props), key = element.key;
    if (null != config2)
      for (propName in void 0 !== config2.key && (key = "" + config2.key), config2)
        !hasOwnProperty.call(config2, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config2.ref || (props[propName] = config2[propName]);
    var propName = arguments.length - 2;
    if (1 === propName) props.children = children;
    else if (1 < propName) {
      for (var childArray = Array(propName), i = 0; i < propName; i++)
        childArray[i] = arguments[i + 2];
      props.children = childArray;
    }
    return ReactElement(element.type, key, props);
  };
  react_production.createContext = function(defaultValue) {
    defaultValue = {
      $$typeof: REACT_CONTEXT_TYPE,
      _currentValue: defaultValue,
      _currentValue2: defaultValue,
      _threadCount: 0,
      Provider: null,
      Consumer: null
    };
    defaultValue.Provider = defaultValue;
    defaultValue.Consumer = {
      $$typeof: REACT_CONSUMER_TYPE,
      _context: defaultValue
    };
    return defaultValue;
  };
  react_production.createElement = function(type, config2, children) {
    var propName, props = {}, key = null;
    if (null != config2)
      for (propName in void 0 !== config2.key && (key = "" + config2.key), config2)
        hasOwnProperty.call(config2, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (props[propName] = config2[propName]);
    var childrenLength = arguments.length - 2;
    if (1 === childrenLength) props.children = children;
    else if (1 < childrenLength) {
      for (var childArray = Array(childrenLength), i = 0; i < childrenLength; i++)
        childArray[i] = arguments[i + 2];
      props.children = childArray;
    }
    if (type && type.defaultProps)
      for (propName in childrenLength = type.defaultProps, childrenLength)
        void 0 === props[propName] && (props[propName] = childrenLength[propName]);
    return ReactElement(type, key, props);
  };
  react_production.createRef = function() {
    return { current: null };
  };
  react_production.forwardRef = function(render) {
    return { $$typeof: REACT_FORWARD_REF_TYPE, render };
  };
  react_production.isValidElement = isValidElement;
  react_production.lazy = function(ctor) {
    return {
      $$typeof: REACT_LAZY_TYPE,
      _payload: { _status: -1, _result: ctor },
      _init: lazyInitializer
    };
  };
  react_production.memo = function(type, compare) {
    return {
      $$typeof: REACT_MEMO_TYPE,
      type,
      compare: void 0 === compare ? null : compare
    };
  };
  react_production.startTransition = function(scope) {
    var prevTransition = ReactSharedInternals.T, currentTransition = {};
    ReactSharedInternals.T = currentTransition;
    try {
      var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
      null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
      "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && returnValue.then(noop, reportGlobalError);
    } catch (error) {
      reportGlobalError(error);
    } finally {
      null !== prevTransition && null !== currentTransition.types && (prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
    }
  };
  react_production.unstable_useCacheRefresh = function() {
    return ReactSharedInternals.H.useCacheRefresh();
  };
  react_production.use = function(usable) {
    return ReactSharedInternals.H.use(usable);
  };
  react_production.useActionState = function(action, initialState, permalink) {
    return ReactSharedInternals.H.useActionState(action, initialState, permalink);
  };
  react_production.useCallback = function(callback, deps) {
    return ReactSharedInternals.H.useCallback(callback, deps);
  };
  react_production.useContext = function(Context) {
    return ReactSharedInternals.H.useContext(Context);
  };
  react_production.useDebugValue = function() {
  };
  react_production.useDeferredValue = function(value, initialValue) {
    return ReactSharedInternals.H.useDeferredValue(value, initialValue);
  };
  react_production.useEffect = function(create, deps) {
    return ReactSharedInternals.H.useEffect(create, deps);
  };
  react_production.useEffectEvent = function(callback) {
    return ReactSharedInternals.H.useEffectEvent(callback);
  };
  react_production.useId = function() {
    return ReactSharedInternals.H.useId();
  };
  react_production.useImperativeHandle = function(ref, create, deps) {
    return ReactSharedInternals.H.useImperativeHandle(ref, create, deps);
  };
  react_production.useInsertionEffect = function(create, deps) {
    return ReactSharedInternals.H.useInsertionEffect(create, deps);
  };
  react_production.useLayoutEffect = function(create, deps) {
    return ReactSharedInternals.H.useLayoutEffect(create, deps);
  };
  react_production.useMemo = function(create, deps) {
    return ReactSharedInternals.H.useMemo(create, deps);
  };
  react_production.useOptimistic = function(passthrough, reducer) {
    return ReactSharedInternals.H.useOptimistic(passthrough, reducer);
  };
  react_production.useReducer = function(reducer, initialArg, init) {
    return ReactSharedInternals.H.useReducer(reducer, initialArg, init);
  };
  react_production.useRef = function(initialValue) {
    return ReactSharedInternals.H.useRef(initialValue);
  };
  react_production.useState = function(initialState) {
    return ReactSharedInternals.H.useState(initialState);
  };
  react_production.useSyncExternalStore = function(subscribe, getSnapshot, getServerSnapshot) {
    return ReactSharedInternals.H.useSyncExternalStore(
      subscribe,
      getSnapshot,
      getServerSnapshot
    );
  };
  react_production.useTransition = function() {
    return ReactSharedInternals.H.useTransition();
  };
  react_production.version = "19.2.4";
  return react_production;
}
__name(requireReact_production, "requireReact_production");
var react_development = { exports: {} };
/**
 * @license React
 * react.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
react_development.exports;
var hasRequiredReact_development;
function requireReact_development() {
  if (hasRequiredReact_development) return react_development.exports;
  hasRequiredReact_development = 1;
  (function(module, exports) {
    "production" !== process.env.NODE_ENV && function() {
      function defineDeprecationWarning(methodName, info) {
        Object.defineProperty(Component.prototype, methodName, {
          get: /* @__PURE__ */ __name(function() {
            console.warn(
              "%s(...) is deprecated in plain JavaScript React classes. %s",
              info[0],
              info[1]
            );
          }, "get")
        });
      }
      __name(defineDeprecationWarning, "defineDeprecationWarning");
      function getIteratorFn(maybeIterable) {
        if (null === maybeIterable || "object" !== typeof maybeIterable)
          return null;
        maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
        return "function" === typeof maybeIterable ? maybeIterable : null;
      }
      __name(getIteratorFn, "getIteratorFn");
      function warnNoop(publicInstance, callerName) {
        publicInstance = (publicInstance = publicInstance.constructor) && (publicInstance.displayName || publicInstance.name) || "ReactClass";
        var warningKey = publicInstance + "." + callerName;
        didWarnStateUpdateForUnmountedComponent[warningKey] || (console.error(
          "Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to `this.state` directly or define a `state = {};` class property with the desired state in the %s component.",
          callerName,
          publicInstance
        ), didWarnStateUpdateForUnmountedComponent[warningKey] = true);
      }
      __name(warnNoop, "warnNoop");
      function Component(props, context, updater) {
        this.props = props;
        this.context = context;
        this.refs = emptyObject;
        this.updater = updater || ReactNoopUpdateQueue;
      }
      __name(Component, "Component");
      function ComponentDummy() {
      }
      __name(ComponentDummy, "ComponentDummy");
      function PureComponent(props, context, updater) {
        this.props = props;
        this.context = context;
        this.refs = emptyObject;
        this.updater = updater || ReactNoopUpdateQueue;
      }
      __name(PureComponent, "PureComponent");
      function noop() {
      }
      __name(noop, "noop");
      function testStringCoercion(value) {
        return "" + value;
      }
      __name(testStringCoercion, "testStringCoercion");
      function checkKeyStringCoercion(value) {
        try {
          testStringCoercion(value);
          var JSCompiler_inline_result = false;
        } catch (e) {
          JSCompiler_inline_result = true;
        }
        if (JSCompiler_inline_result) {
          JSCompiler_inline_result = console;
          var JSCompiler_temp_const = JSCompiler_inline_result.error;
          var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
          JSCompiler_temp_const.call(
            JSCompiler_inline_result,
            "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
            JSCompiler_inline_result$jscomp$0
          );
          return testStringCoercion(value);
        }
      }
      __name(checkKeyStringCoercion, "checkKeyStringCoercion");
      function getComponentNameFromType(type) {
        if (null == type) return null;
        if ("function" === typeof type)
          return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
        if ("string" === typeof type) return type;
        switch (type) {
          case REACT_FRAGMENT_TYPE:
            return "Fragment";
          case REACT_PROFILER_TYPE:
            return "Profiler";
          case REACT_STRICT_MODE_TYPE:
            return "StrictMode";
          case REACT_SUSPENSE_TYPE:
            return "Suspense";
          case REACT_SUSPENSE_LIST_TYPE:
            return "SuspenseList";
          case REACT_ACTIVITY_TYPE:
            return "Activity";
        }
        if ("object" === typeof type)
          switch ("number" === typeof type.tag && console.error(
            "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
          ), type.$$typeof) {
            case REACT_PORTAL_TYPE:
              return "Portal";
            case REACT_CONTEXT_TYPE:
              return type.displayName || "Context";
            case REACT_CONSUMER_TYPE:
              return (type._context.displayName || "Context") + ".Consumer";
            case REACT_FORWARD_REF_TYPE:
              var innerType = type.render;
              type = type.displayName;
              type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
              return type;
            case REACT_MEMO_TYPE:
              return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
            case REACT_LAZY_TYPE:
              innerType = type._payload;
              type = type._init;
              try {
                return getComponentNameFromType(type(innerType));
              } catch (x) {
              }
          }
        return null;
      }
      __name(getComponentNameFromType, "getComponentNameFromType");
      function getTaskName(type) {
        if (type === REACT_FRAGMENT_TYPE) return "<>";
        if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE)
          return "<...>";
        try {
          var name = getComponentNameFromType(type);
          return name ? "<" + name + ">" : "<...>";
        } catch (x) {
          return "<...>";
        }
      }
      __name(getTaskName, "getTaskName");
      function getOwner() {
        var dispatcher = ReactSharedInternals.A;
        return null === dispatcher ? null : dispatcher.getOwner();
      }
      __name(getOwner, "getOwner");
      function UnknownOwner() {
        return Error("react-stack-top-frame");
      }
      __name(UnknownOwner, "UnknownOwner");
      function hasValidKey(config2) {
        if (hasOwnProperty.call(config2, "key")) {
          var getter = Object.getOwnPropertyDescriptor(config2, "key").get;
          if (getter && getter.isReactWarning) return false;
        }
        return void 0 !== config2.key;
      }
      __name(hasValidKey, "hasValidKey");
      function defineKeyPropWarningGetter(props, displayName) {
        function warnAboutAccessingKey() {
          specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
            "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
            displayName
          ));
        }
        __name(warnAboutAccessingKey, "warnAboutAccessingKey");
        warnAboutAccessingKey.isReactWarning = true;
        Object.defineProperty(props, "key", {
          get: warnAboutAccessingKey,
          configurable: true
        });
      }
      __name(defineKeyPropWarningGetter, "defineKeyPropWarningGetter");
      function elementRefGetterWithDeprecationWarning() {
        var componentName = getComponentNameFromType(this.type);
        didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
          "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
        ));
        componentName = this.props.ref;
        return void 0 !== componentName ? componentName : null;
      }
      __name(elementRefGetterWithDeprecationWarning, "elementRefGetterWithDeprecationWarning");
      function ReactElement(type, key, props, owner, debugStack, debugTask) {
        var refProp = props.ref;
        type = {
          $$typeof: REACT_ELEMENT_TYPE,
          type,
          key,
          props,
          _owner: owner
        };
        null !== (void 0 !== refProp ? refProp : null) ? Object.defineProperty(type, "ref", {
          enumerable: false,
          get: elementRefGetterWithDeprecationWarning
        }) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
        type._store = {};
        Object.defineProperty(type._store, "validated", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: 0
        });
        Object.defineProperty(type, "_debugInfo", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: null
        });
        Object.defineProperty(type, "_debugStack", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: debugStack
        });
        Object.defineProperty(type, "_debugTask", {
          configurable: false,
          enumerable: false,
          writable: true,
          value: debugTask
        });
        Object.freeze && (Object.freeze(type.props), Object.freeze(type));
        return type;
      }
      __name(ReactElement, "ReactElement");
      function cloneAndReplaceKey(oldElement, newKey) {
        newKey = ReactElement(
          oldElement.type,
          newKey,
          oldElement.props,
          oldElement._owner,
          oldElement._debugStack,
          oldElement._debugTask
        );
        oldElement._store && (newKey._store.validated = oldElement._store.validated);
        return newKey;
      }
      __name(cloneAndReplaceKey, "cloneAndReplaceKey");
      function validateChildKeys(node) {
        isValidElement(node) ? node._store && (node._store.validated = 1) : "object" === typeof node && null !== node && node.$$typeof === REACT_LAZY_TYPE && ("fulfilled" === node._payload.status ? isValidElement(node._payload.value) && node._payload.value._store && (node._payload.value._store.validated = 1) : node._store && (node._store.validated = 1));
      }
      __name(validateChildKeys, "validateChildKeys");
      function isValidElement(object) {
        return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
      }
      __name(isValidElement, "isValidElement");
      function escape(key) {
        var escaperLookup = { "=": "=0", ":": "=2" };
        return "$" + key.replace(/[=:]/g, function(match) {
          return escaperLookup[match];
        });
      }
      __name(escape, "escape");
      function getElementKey(element, index2) {
        return "object" === typeof element && null !== element && null != element.key ? (checkKeyStringCoercion(element.key), escape("" + element.key)) : index2.toString(36);
      }
      __name(getElementKey, "getElementKey");
      function resolveThenable(thenable) {
        switch (thenable.status) {
          case "fulfilled":
            return thenable.value;
          case "rejected":
            throw thenable.reason;
          default:
            switch ("string" === typeof thenable.status ? thenable.then(noop, noop) : (thenable.status = "pending", thenable.then(
              function(fulfilledValue) {
                "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
              },
              function(error) {
                "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
              }
            )), thenable.status) {
              case "fulfilled":
                return thenable.value;
              case "rejected":
                throw thenable.reason;
            }
        }
        throw thenable;
      }
      __name(resolveThenable, "resolveThenable");
      function mapIntoArray(children, array2, escapedPrefix, nameSoFar, callback) {
        var type = typeof children;
        if ("undefined" === type || "boolean" === type) children = null;
        var invokeCallback = false;
        if (null === children) invokeCallback = true;
        else
          switch (type) {
            case "bigint":
            case "string":
            case "number":
              invokeCallback = true;
              break;
            case "object":
              switch (children.$$typeof) {
                case REACT_ELEMENT_TYPE:
                case REACT_PORTAL_TYPE:
                  invokeCallback = true;
                  break;
                case REACT_LAZY_TYPE:
                  return invokeCallback = children._init, mapIntoArray(
                    invokeCallback(children._payload),
                    array2,
                    escapedPrefix,
                    nameSoFar,
                    callback
                  );
              }
          }
        if (invokeCallback) {
          invokeCallback = children;
          callback = callback(invokeCallback);
          var childKey = "" === nameSoFar ? "." + getElementKey(invokeCallback, 0) : nameSoFar;
          isArrayImpl(callback) ? (escapedPrefix = "", null != childKey && (escapedPrefix = childKey.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array2, escapedPrefix, "", function(c) {
            return c;
          })) : null != callback && (isValidElement(callback) && (null != callback.key && (invokeCallback && invokeCallback.key === callback.key || checkKeyStringCoercion(callback.key)), escapedPrefix = cloneAndReplaceKey(
            callback,
            escapedPrefix + (null == callback.key || invokeCallback && invokeCallback.key === callback.key ? "" : ("" + callback.key).replace(
              userProvidedKeyEscapeRegex,
              "$&/"
            ) + "/") + childKey
          ), "" !== nameSoFar && null != invokeCallback && isValidElement(invokeCallback) && null == invokeCallback.key && invokeCallback._store && !invokeCallback._store.validated && (escapedPrefix._store.validated = 2), callback = escapedPrefix), array2.push(callback));
          return 1;
        }
        invokeCallback = 0;
        childKey = "" === nameSoFar ? "." : nameSoFar + ":";
        if (isArrayImpl(children))
          for (var i = 0; i < children.length; i++)
            nameSoFar = children[i], type = childKey + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
              nameSoFar,
              array2,
              escapedPrefix,
              type,
              callback
            );
        else if (i = getIteratorFn(children), "function" === typeof i)
          for (i === children.entries && (didWarnAboutMaps || console.warn(
            "Using Maps as children is not supported. Use an array of keyed ReactElements instead."
          ), didWarnAboutMaps = true), children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
            nameSoFar = nameSoFar.value, type = childKey + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
              nameSoFar,
              array2,
              escapedPrefix,
              type,
              callback
            );
        else if ("object" === type) {
          if ("function" === typeof children.then)
            return mapIntoArray(
              resolveThenable(children),
              array2,
              escapedPrefix,
              nameSoFar,
              callback
            );
          array2 = String(children);
          throw Error(
            "Objects are not valid as a React child (found: " + ("[object Object]" === array2 ? "object with keys {" + Object.keys(children).join(", ") + "}" : array2) + "). If you meant to render a collection of children, use an array instead."
          );
        }
        return invokeCallback;
      }
      __name(mapIntoArray, "mapIntoArray");
      function mapChildren(children, func, context) {
        if (null == children) return children;
        var result = [], count = 0;
        mapIntoArray(children, result, "", "", function(child) {
          return func.call(context, child, count++);
        });
        return result;
      }
      __name(mapChildren, "mapChildren");
      function lazyInitializer(payload) {
        if (-1 === payload._status) {
          var ioInfo = payload._ioInfo;
          null != ioInfo && (ioInfo.start = ioInfo.end = performance.now());
          ioInfo = payload._result;
          var thenable = ioInfo();
          thenable.then(
            function(moduleObject) {
              if (0 === payload._status || -1 === payload._status) {
                payload._status = 1;
                payload._result = moduleObject;
                var _ioInfo = payload._ioInfo;
                null != _ioInfo && (_ioInfo.end = performance.now());
                void 0 === thenable.status && (thenable.status = "fulfilled", thenable.value = moduleObject);
              }
            },
            function(error) {
              if (0 === payload._status || -1 === payload._status) {
                payload._status = 2;
                payload._result = error;
                var _ioInfo2 = payload._ioInfo;
                null != _ioInfo2 && (_ioInfo2.end = performance.now());
                void 0 === thenable.status && (thenable.status = "rejected", thenable.reason = error);
              }
            }
          );
          ioInfo = payload._ioInfo;
          if (null != ioInfo) {
            ioInfo.value = thenable;
            var displayName = thenable.displayName;
            "string" === typeof displayName && (ioInfo.name = displayName);
          }
          -1 === payload._status && (payload._status = 0, payload._result = thenable);
        }
        if (1 === payload._status)
          return ioInfo = payload._result, void 0 === ioInfo && console.error(
            "lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))\n\nDid you accidentally put curly braces around the import?",
            ioInfo
          ), "default" in ioInfo || console.error(
            "lazy: Expected the result of a dynamic import() call. Instead received: %s\n\nYour code should look like: \n  const MyComponent = lazy(() => import('./MyComponent'))",
            ioInfo
          ), ioInfo.default;
        throw payload._result;
      }
      __name(lazyInitializer, "lazyInitializer");
      function resolveDispatcher() {
        var dispatcher = ReactSharedInternals.H;
        null === dispatcher && console.error(
          "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem."
        );
        return dispatcher;
      }
      __name(resolveDispatcher, "resolveDispatcher");
      function releaseAsyncTransition() {
        ReactSharedInternals.asyncTransitions--;
      }
      __name(releaseAsyncTransition, "releaseAsyncTransition");
      function enqueueTask(task) {
        if (null === enqueueTaskImpl)
          try {
            var requireString = ("require" + Math.random()).slice(0, 7);
            enqueueTaskImpl = (module && module[requireString]).call(
              module,
              "timers"
            ).setImmediate;
          } catch (_err) {
            enqueueTaskImpl = /* @__PURE__ */ __name(function(callback) {
              false === didWarnAboutMessageChannel && (didWarnAboutMessageChannel = true, "undefined" === typeof MessageChannel && console.error(
                "This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning."
              ));
              var channel = new MessageChannel();
              channel.port1.onmessage = callback;
              channel.port2.postMessage(void 0);
            }, "enqueueTaskImpl");
          }
        return enqueueTaskImpl(task);
      }
      __name(enqueueTask, "enqueueTask");
      function aggregateErrors(errors) {
        return 1 < errors.length && "function" === typeof AggregateError ? new AggregateError(errors) : errors[0];
      }
      __name(aggregateErrors, "aggregateErrors");
      function popActScope(prevActQueue, prevActScopeDepth) {
        prevActScopeDepth !== actScopeDepth - 1 && console.error(
          "You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. "
        );
        actScopeDepth = prevActScopeDepth;
      }
      __name(popActScope, "popActScope");
      function recursivelyFlushAsyncActWork(returnValue, resolve, reject) {
        var queue = ReactSharedInternals.actQueue;
        if (null !== queue)
          if (0 !== queue.length)
            try {
              flushActQueue(queue);
              enqueueTask(function() {
                return recursivelyFlushAsyncActWork(returnValue, resolve, reject);
              });
              return;
            } catch (error) {
              ReactSharedInternals.thrownErrors.push(error);
            }
          else ReactSharedInternals.actQueue = null;
        0 < ReactSharedInternals.thrownErrors.length ? (queue = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, reject(queue)) : resolve(returnValue);
      }
      __name(recursivelyFlushAsyncActWork, "recursivelyFlushAsyncActWork");
      function flushActQueue(queue) {
        if (!isFlushing) {
          isFlushing = true;
          var i = 0;
          try {
            for (; i < queue.length; i++) {
              var callback = queue[i];
              do {
                ReactSharedInternals.didUsePromise = false;
                var continuation = callback(false);
                if (null !== continuation) {
                  if (ReactSharedInternals.didUsePromise) {
                    queue[i] = callback;
                    queue.splice(0, i);
                    return;
                  }
                  callback = continuation;
                } else break;
              } while (1);
            }
            queue.length = 0;
          } catch (error) {
            queue.splice(0, i + 1), ReactSharedInternals.thrownErrors.push(error);
          } finally {
            isFlushing = false;
          }
        }
      }
      __name(flushActQueue, "flushActQueue");
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = Symbol.for("react.profiler"), REACT_CONSUMER_TYPE = Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = Symbol.for("react.memo"), REACT_LAZY_TYPE = Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = Symbol.for("react.activity"), MAYBE_ITERATOR_SYMBOL = Symbol.iterator, didWarnStateUpdateForUnmountedComponent = {}, ReactNoopUpdateQueue = {
        isMounted: /* @__PURE__ */ __name(function() {
          return false;
        }, "isMounted"),
        enqueueForceUpdate: /* @__PURE__ */ __name(function(publicInstance) {
          warnNoop(publicInstance, "forceUpdate");
        }, "enqueueForceUpdate"),
        enqueueReplaceState: /* @__PURE__ */ __name(function(publicInstance) {
          warnNoop(publicInstance, "replaceState");
        }, "enqueueReplaceState"),
        enqueueSetState: /* @__PURE__ */ __name(function(publicInstance) {
          warnNoop(publicInstance, "setState");
        }, "enqueueSetState")
      }, assign = Object.assign, emptyObject = {};
      Object.freeze(emptyObject);
      Component.prototype.isReactComponent = {};
      Component.prototype.setState = function(partialState, callback) {
        if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
          throw Error(
            "takes an object of state variables to update or a function which returns an object of state variables."
          );
        this.updater.enqueueSetState(this, partialState, callback, "setState");
      };
      Component.prototype.forceUpdate = function(callback) {
        this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
      };
      var deprecatedAPIs = {
        isMounted: [
          "isMounted",
          "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."
        ],
        replaceState: [
          "replaceState",
          "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."
        ]
      };
      for (fnName in deprecatedAPIs)
        deprecatedAPIs.hasOwnProperty(fnName) && defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
      ComponentDummy.prototype = Component.prototype;
      deprecatedAPIs = PureComponent.prototype = new ComponentDummy();
      deprecatedAPIs.constructor = PureComponent;
      assign(deprecatedAPIs, Component.prototype);
      deprecatedAPIs.isPureReactComponent = true;
      var isArrayImpl = Array.isArray, REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"), ReactSharedInternals = {
        H: null,
        A: null,
        T: null,
        S: null,
        actQueue: null,
        asyncTransitions: 0,
        isBatchingLegacy: false,
        didScheduleLegacyUpdate: false,
        didUsePromise: false,
        thrownErrors: [],
        getCurrentStack: null,
        recentlyCreatedOwnerStacks: 0
      }, hasOwnProperty = Object.prototype.hasOwnProperty, createTask = console.createTask ? console.createTask : function() {
        return null;
      };
      deprecatedAPIs = {
        react_stack_bottom_frame: /* @__PURE__ */ __name(function(callStackForError) {
          return callStackForError();
        }, "react_stack_bottom_frame")
      };
      var specialPropKeyWarningShown, didWarnAboutOldJSXRuntime;
      var didWarnAboutElementRef = {};
      var unknownOwnerDebugStack = deprecatedAPIs.react_stack_bottom_frame.bind(
        deprecatedAPIs,
        UnknownOwner
      )();
      var unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
      var didWarnAboutMaps = false, userProvidedKeyEscapeRegex = /\/+/g, reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
        if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
          var event = new window.ErrorEvent("error", {
            bubbles: true,
            cancelable: true,
            message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
            error
          });
          if (!window.dispatchEvent(event)) return;
        } else if ("object" === typeof process && "function" === typeof process.emit) {
          process.emit("uncaughtException", error);
          return;
        }
        console.error(error);
      }, didWarnAboutMessageChannel = false, enqueueTaskImpl = null, actScopeDepth = 0, didWarnNoAwaitAct = false, isFlushing = false, queueSeveralMicrotasks = "function" === typeof queueMicrotask ? function(callback) {
        queueMicrotask(function() {
          return queueMicrotask(callback);
        });
      } : enqueueTask;
      deprecatedAPIs = Object.freeze({
        __proto__: null,
        c: /* @__PURE__ */ __name(function(size) {
          return resolveDispatcher().useMemoCache(size);
        }, "c")
      });
      var fnName = {
        map: mapChildren,
        forEach: /* @__PURE__ */ __name(function(children, forEachFunc, forEachContext) {
          mapChildren(
            children,
            function() {
              forEachFunc.apply(this, arguments);
            },
            forEachContext
          );
        }, "forEach"),
        count: /* @__PURE__ */ __name(function(children) {
          var n = 0;
          mapChildren(children, function() {
            n++;
          });
          return n;
        }, "count"),
        toArray: /* @__PURE__ */ __name(function(children) {
          return mapChildren(children, function(child) {
            return child;
          }) || [];
        }, "toArray"),
        only: /* @__PURE__ */ __name(function(children) {
          if (!isValidElement(children))
            throw Error(
              "React.Children.only expected to receive a single React element child."
            );
          return children;
        }, "only")
      };
      exports.Activity = REACT_ACTIVITY_TYPE;
      exports.Children = fnName;
      exports.Component = Component;
      exports.Fragment = REACT_FRAGMENT_TYPE;
      exports.Profiler = REACT_PROFILER_TYPE;
      exports.PureComponent = PureComponent;
      exports.StrictMode = REACT_STRICT_MODE_TYPE;
      exports.Suspense = REACT_SUSPENSE_TYPE;
      exports.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
      exports.__COMPILER_RUNTIME = deprecatedAPIs;
      exports.act = function(callback) {
        var prevActQueue = ReactSharedInternals.actQueue, prevActScopeDepth = actScopeDepth;
        actScopeDepth++;
        var queue = ReactSharedInternals.actQueue = null !== prevActQueue ? prevActQueue : [], didAwaitActCall = false;
        try {
          var result = callback();
        } catch (error) {
          ReactSharedInternals.thrownErrors.push(error);
        }
        if (0 < ReactSharedInternals.thrownErrors.length)
          throw popActScope(prevActQueue, prevActScopeDepth), callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
        if (null !== result && "object" === typeof result && "function" === typeof result.then) {
          var thenable = result;
          queueSeveralMicrotasks(function() {
            didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
              "You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);"
            ));
          });
          return {
            then: /* @__PURE__ */ __name(function(resolve, reject) {
              didAwaitActCall = true;
              thenable.then(
                function(returnValue) {
                  popActScope(prevActQueue, prevActScopeDepth);
                  if (0 === prevActScopeDepth) {
                    try {
                      flushActQueue(queue), enqueueTask(function() {
                        return recursivelyFlushAsyncActWork(
                          returnValue,
                          resolve,
                          reject
                        );
                      });
                    } catch (error$0) {
                      ReactSharedInternals.thrownErrors.push(error$0);
                    }
                    if (0 < ReactSharedInternals.thrownErrors.length) {
                      var _thrownError = aggregateErrors(
                        ReactSharedInternals.thrownErrors
                      );
                      ReactSharedInternals.thrownErrors.length = 0;
                      reject(_thrownError);
                    }
                  } else resolve(returnValue);
                },
                function(error) {
                  popActScope(prevActQueue, prevActScopeDepth);
                  0 < ReactSharedInternals.thrownErrors.length ? (error = aggregateErrors(
                    ReactSharedInternals.thrownErrors
                  ), ReactSharedInternals.thrownErrors.length = 0, reject(error)) : reject(error);
                }
              );
            }, "then")
          };
        }
        var returnValue$jscomp$0 = result;
        popActScope(prevActQueue, prevActScopeDepth);
        0 === prevActScopeDepth && (flushActQueue(queue), 0 !== queue.length && queueSeveralMicrotasks(function() {
          didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
            "A component suspended inside an `act` scope, but the `act` call was not awaited. When testing React components that depend on asynchronous data, you must await the result:\n\nawait act(() => ...)"
          ));
        }), ReactSharedInternals.actQueue = null);
        if (0 < ReactSharedInternals.thrownErrors.length)
          throw callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
        return {
          then: /* @__PURE__ */ __name(function(resolve, reject) {
            didAwaitActCall = true;
            0 === prevActScopeDepth ? (ReactSharedInternals.actQueue = queue, enqueueTask(function() {
              return recursivelyFlushAsyncActWork(
                returnValue$jscomp$0,
                resolve,
                reject
              );
            })) : resolve(returnValue$jscomp$0);
          }, "then")
        };
      };
      exports.cache = function(fn) {
        return function() {
          return fn.apply(null, arguments);
        };
      };
      exports.cacheSignal = function() {
        return null;
      };
      exports.captureOwnerStack = function() {
        var getCurrentStack = ReactSharedInternals.getCurrentStack;
        return null === getCurrentStack ? null : getCurrentStack();
      };
      exports.cloneElement = function(element, config2, children) {
        if (null === element || void 0 === element)
          throw Error(
            "The argument must be a React element, but you passed " + element + "."
          );
        var props = assign({}, element.props), key = element.key, owner = element._owner;
        if (null != config2) {
          var JSCompiler_inline_result;
          a: {
            if (hasOwnProperty.call(config2, "ref") && (JSCompiler_inline_result = Object.getOwnPropertyDescriptor(
              config2,
              "ref"
            ).get) && JSCompiler_inline_result.isReactWarning) {
              JSCompiler_inline_result = false;
              break a;
            }
            JSCompiler_inline_result = void 0 !== config2.ref;
          }
          JSCompiler_inline_result && (owner = getOwner());
          hasValidKey(config2) && (checkKeyStringCoercion(config2.key), key = "" + config2.key);
          for (propName in config2)
            !hasOwnProperty.call(config2, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config2.ref || (props[propName] = config2[propName]);
        }
        var propName = arguments.length - 2;
        if (1 === propName) props.children = children;
        else if (1 < propName) {
          JSCompiler_inline_result = Array(propName);
          for (var i = 0; i < propName; i++)
            JSCompiler_inline_result[i] = arguments[i + 2];
          props.children = JSCompiler_inline_result;
        }
        props = ReactElement(
          element.type,
          key,
          props,
          owner,
          element._debugStack,
          element._debugTask
        );
        for (key = 2; key < arguments.length; key++)
          validateChildKeys(arguments[key]);
        return props;
      };
      exports.createContext = function(defaultValue) {
        defaultValue = {
          $$typeof: REACT_CONTEXT_TYPE,
          _currentValue: defaultValue,
          _currentValue2: defaultValue,
          _threadCount: 0,
          Provider: null,
          Consumer: null
        };
        defaultValue.Provider = defaultValue;
        defaultValue.Consumer = {
          $$typeof: REACT_CONSUMER_TYPE,
          _context: defaultValue
        };
        defaultValue._currentRenderer = null;
        defaultValue._currentRenderer2 = null;
        return defaultValue;
      };
      exports.createElement = function(type, config2, children) {
        for (var i = 2; i < arguments.length; i++)
          validateChildKeys(arguments[i]);
        i = {};
        var key = null;
        if (null != config2)
          for (propName in didWarnAboutOldJSXRuntime || !("__self" in config2) || "key" in config2 || (didWarnAboutOldJSXRuntime = true, console.warn(
            "Your app (or one of its dependencies) is using an outdated JSX transform. Update to the modern JSX transform for faster performance: https://react.dev/link/new-jsx-transform"
          )), hasValidKey(config2) && (checkKeyStringCoercion(config2.key), key = "" + config2.key), config2)
            hasOwnProperty.call(config2, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (i[propName] = config2[propName]);
        var childrenLength = arguments.length - 2;
        if (1 === childrenLength) i.children = children;
        else if (1 < childrenLength) {
          for (var childArray = Array(childrenLength), _i = 0; _i < childrenLength; _i++)
            childArray[_i] = arguments[_i + 2];
          Object.freeze && Object.freeze(childArray);
          i.children = childArray;
        }
        if (type && type.defaultProps)
          for (propName in childrenLength = type.defaultProps, childrenLength)
            void 0 === i[propName] && (i[propName] = childrenLength[propName]);
        key && defineKeyPropWarningGetter(
          i,
          "function" === typeof type ? type.displayName || type.name || "Unknown" : type
        );
        var propName = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
        return ReactElement(
          type,
          key,
          i,
          getOwner(),
          propName ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
          propName ? createTask(getTaskName(type)) : unknownOwnerDebugTask
        );
      };
      exports.createRef = function() {
        var refObject = { current: null };
        Object.seal(refObject);
        return refObject;
      };
      exports.forwardRef = function(render) {
        null != render && render.$$typeof === REACT_MEMO_TYPE ? console.error(
          "forwardRef requires a render function but received a `memo` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...))."
        ) : "function" !== typeof render ? console.error(
          "forwardRef requires a render function but was given %s.",
          null === render ? "null" : typeof render
        ) : 0 !== render.length && 2 !== render.length && console.error(
          "forwardRef render functions accept exactly two parameters: props and ref. %s",
          1 === render.length ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined."
        );
        null != render && null != render.defaultProps && console.error(
          "forwardRef render functions do not support defaultProps. Did you accidentally pass a React component?"
        );
        var elementType = { $$typeof: REACT_FORWARD_REF_TYPE, render }, ownName;
        Object.defineProperty(elementType, "displayName", {
          enumerable: false,
          configurable: true,
          get: /* @__PURE__ */ __name(function() {
            return ownName;
          }, "get"),
          set: /* @__PURE__ */ __name(function(name) {
            ownName = name;
            render.name || render.displayName || (Object.defineProperty(render, "name", { value: name }), render.displayName = name);
          }, "set")
        });
        return elementType;
      };
      exports.isValidElement = isValidElement;
      exports.lazy = function(ctor) {
        ctor = { _status: -1, _result: ctor };
        var lazyType = {
          $$typeof: REACT_LAZY_TYPE,
          _payload: ctor,
          _init: lazyInitializer
        }, ioInfo = {
          name: "lazy",
          start: -1,
          end: -1,
          value: null,
          owner: null,
          debugStack: Error("react-stack-top-frame"),
          debugTask: console.createTask ? console.createTask("lazy()") : null
        };
        ctor._ioInfo = ioInfo;
        lazyType._debugInfo = [{ awaited: ioInfo }];
        return lazyType;
      };
      exports.memo = function(type, compare) {
        null == type && console.error(
          "memo: The first argument must be a component. Instead received: %s",
          null === type ? "null" : typeof type
        );
        compare = {
          $$typeof: REACT_MEMO_TYPE,
          type,
          compare: void 0 === compare ? null : compare
        };
        var ownName;
        Object.defineProperty(compare, "displayName", {
          enumerable: false,
          configurable: true,
          get: /* @__PURE__ */ __name(function() {
            return ownName;
          }, "get"),
          set: /* @__PURE__ */ __name(function(name) {
            ownName = name;
            type.name || type.displayName || (Object.defineProperty(type, "name", { value: name }), type.displayName = name);
          }, "set")
        });
        return compare;
      };
      exports.startTransition = function(scope) {
        var prevTransition = ReactSharedInternals.T, currentTransition = {};
        currentTransition._updatedFibers = /* @__PURE__ */ new Set();
        ReactSharedInternals.T = currentTransition;
        try {
          var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
          null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
          "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && (ReactSharedInternals.asyncTransitions++, returnValue.then(releaseAsyncTransition, releaseAsyncTransition), returnValue.then(noop, reportGlobalError));
        } catch (error) {
          reportGlobalError(error);
        } finally {
          null === prevTransition && currentTransition._updatedFibers && (scope = currentTransition._updatedFibers.size, currentTransition._updatedFibers.clear(), 10 < scope && console.warn(
            "Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table."
          )), null !== prevTransition && null !== currentTransition.types && (null !== prevTransition.types && prevTransition.types !== currentTransition.types && console.error(
            "We expected inner Transitions to have transferred the outer types set and that you cannot add to the outer Transition while inside the inner.This is a bug in React."
          ), prevTransition.types = currentTransition.types), ReactSharedInternals.T = prevTransition;
        }
      };
      exports.unstable_useCacheRefresh = function() {
        return resolveDispatcher().useCacheRefresh();
      };
      exports.use = function(usable) {
        return resolveDispatcher().use(usable);
      };
      exports.useActionState = function(action, initialState, permalink) {
        return resolveDispatcher().useActionState(
          action,
          initialState,
          permalink
        );
      };
      exports.useCallback = function(callback, deps) {
        return resolveDispatcher().useCallback(callback, deps);
      };
      exports.useContext = function(Context) {
        var dispatcher = resolveDispatcher();
        Context.$$typeof === REACT_CONSUMER_TYPE && console.error(
          "Calling useContext(Context.Consumer) is not supported and will cause bugs. Did you mean to call useContext(Context) instead?"
        );
        return dispatcher.useContext(Context);
      };
      exports.useDebugValue = function(value, formatterFn) {
        return resolveDispatcher().useDebugValue(value, formatterFn);
      };
      exports.useDeferredValue = function(value, initialValue) {
        return resolveDispatcher().useDeferredValue(value, initialValue);
      };
      exports.useEffect = function(create, deps) {
        null == create && console.warn(
          "React Hook useEffect requires an effect callback. Did you forget to pass a callback to the hook?"
        );
        return resolveDispatcher().useEffect(create, deps);
      };
      exports.useEffectEvent = function(callback) {
        return resolveDispatcher().useEffectEvent(callback);
      };
      exports.useId = function() {
        return resolveDispatcher().useId();
      };
      exports.useImperativeHandle = function(ref, create, deps) {
        return resolveDispatcher().useImperativeHandle(ref, create, deps);
      };
      exports.useInsertionEffect = function(create, deps) {
        null == create && console.warn(
          "React Hook useInsertionEffect requires an effect callback. Did you forget to pass a callback to the hook?"
        );
        return resolveDispatcher().useInsertionEffect(create, deps);
      };
      exports.useLayoutEffect = function(create, deps) {
        null == create && console.warn(
          "React Hook useLayoutEffect requires an effect callback. Did you forget to pass a callback to the hook?"
        );
        return resolveDispatcher().useLayoutEffect(create, deps);
      };
      exports.useMemo = function(create, deps) {
        return resolveDispatcher().useMemo(create, deps);
      };
      exports.useOptimistic = function(passthrough, reducer) {
        return resolveDispatcher().useOptimistic(passthrough, reducer);
      };
      exports.useReducer = function(reducer, initialArg, init) {
        return resolveDispatcher().useReducer(reducer, initialArg, init);
      };
      exports.useRef = function(initialValue) {
        return resolveDispatcher().useRef(initialValue);
      };
      exports.useState = function(initialState) {
        return resolveDispatcher().useState(initialState);
      };
      exports.useSyncExternalStore = function(subscribe, getSnapshot, getServerSnapshot) {
        return resolveDispatcher().useSyncExternalStore(
          subscribe,
          getSnapshot,
          getServerSnapshot
        );
      };
      exports.useTransition = function() {
        return resolveDispatcher().useTransition();
      };
      exports.version = "19.2.4";
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    }();
  })(react_development, react_development.exports);
  return react_development.exports;
}
__name(requireReact_development, "requireReact_development");
if (process.env.NODE_ENV === "production") {
  react.exports = requireReact_production();
} else {
  react.exports = requireReact_development();
}
var reactExports = react.exports;
const React = /* @__PURE__ */ getDefaultExportFromCjs(reactExports);
const index = /* @__PURE__ */ _mergeNamespaces({
  __proto__: null,
  default: React
}, [reactExports]);
function getWebcryptoSubtle() {
  const cr = typeof globalThis !== "undefined" && globalThis.crypto;
  if (cr && typeof cr.subtle === "object" && cr.subtle != null)
    return cr.subtle;
  throw new Error("crypto.subtle must be defined");
}
__name(getWebcryptoSubtle, "getWebcryptoSubtle");
const EmptyObject = /* @__PURE__ */ (() => {
  const C = /* @__PURE__ */ __name(function() {
  }, "C");
  C.prototype = /* @__PURE__ */ Object.create(null);
  return C;
})();
function createRouter$1() {
  const ctx = {
    root: { key: "" },
    static: new EmptyObject()
  };
  return ctx;
}
__name(createRouter$1, "createRouter$1");
function splitPath(path2) {
  return path2.split("/").filter(Boolean);
}
__name(splitPath, "splitPath");
function getMatchParams(segments, paramsMap) {
  const params = new EmptyObject();
  for (const [index2, name] of paramsMap) {
    const segment = index2 < 0 ? segments.slice(-1 * index2).join("/") : segments[index2];
    if (typeof name === "string") {
      params[name] = segment;
    } else {
      const match = segment.match(name);
      if (match) {
        for (const key in match.groups) {
          params[key] = match.groups[key];
        }
      }
    }
  }
  return params;
}
__name(getMatchParams, "getMatchParams");
function addRoute(ctx, method = "", path2, data) {
  var _a2;
  const segments = splitPath(path2);
  let node = ctx.root;
  let _unnamedParamIndex = 0;
  const paramsMap = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.startsWith("**")) {
      if (!node.wildcard) {
        node.wildcard = { key: "**" };
      }
      node = node.wildcard;
      paramsMap.push([
        -i,
        segment.split(":")[1] || "_",
        segment.length === 2
      ]);
      break;
    }
    if (segment === "*" || segment.includes(":")) {
      if (!node.param) {
        node.param = { key: "*" };
      }
      node = node.param;
      const isOptional = segment === "*";
      paramsMap.push([
        i,
        isOptional ? `_${_unnamedParamIndex++}` : _getParamMatcher(segment),
        isOptional
      ]);
      continue;
    }
    const child = (_a2 = node.static) == null ? void 0 : _a2[segment];
    if (child) {
      node = child;
    } else {
      const staticNode = { key: segment };
      if (!node.static) {
        node.static = new EmptyObject();
      }
      node.static[segment] = staticNode;
      node = staticNode;
    }
  }
  const hasParams = paramsMap.length > 0;
  if (!node.methods) {
    node.methods = new EmptyObject();
  }
  if (!node.methods[method]) {
    node.methods[method] = [];
  }
  node.methods[method].push({
    data: data || null,
    paramsMap: hasParams ? paramsMap : void 0
  });
  if (!hasParams) {
    ctx.static[path2] = node;
  }
}
__name(addRoute, "addRoute");
function _getParamMatcher(segment) {
  if (!segment.includes(":", 1)) {
    return segment.slice(1);
  }
  const regex = segment.replace(/:(\w+)/g, (_, id) => `(?<${id}>\\w+)`);
  return new RegExp(`^${regex}$`);
}
__name(_getParamMatcher, "_getParamMatcher");
function findRoute(ctx, method = "", path2, opts) {
  var _a2;
  if (path2[path2.length - 1] === "/") {
    path2 = path2.slice(0, -1);
  }
  const staticNode = ctx.static[path2];
  if (staticNode && staticNode.methods) {
    const staticMatch = staticNode.methods[method] || staticNode.methods[""];
    if (staticMatch !== void 0) {
      return staticMatch[0];
    }
  }
  const segments = splitPath(path2);
  const match = (_a2 = _lookupTree(ctx, ctx.root, method, segments, 0)) == null ? void 0 : _a2[0];
  if (match === void 0) {
    return;
  }
  return {
    data: match.data,
    params: match.paramsMap ? getMatchParams(segments, match.paramsMap) : void 0
  };
}
__name(findRoute, "findRoute");
function _lookupTree(ctx, node, method, segments, index2) {
  var _a2, _b2;
  if (index2 === segments.length) {
    if (node.methods) {
      const match = node.methods[method] || node.methods[""];
      if (match) {
        return match;
      }
    }
    if (node.param && node.param.methods) {
      const match = node.param.methods[method] || node.param.methods[""];
      if (match) {
        const pMap = match[0].paramsMap;
        if ((_a2 = pMap == null ? void 0 : pMap[(pMap == null ? void 0 : pMap.length) - 1]) == null ? void 0 : _a2[2]) {
          return match;
        }
      }
    }
    if (node.wildcard && node.wildcard.methods) {
      const match = node.wildcard.methods[method] || node.wildcard.methods[""];
      if (match) {
        const pMap = match[0].paramsMap;
        if ((_b2 = pMap == null ? void 0 : pMap[(pMap == null ? void 0 : pMap.length) - 1]) == null ? void 0 : _b2[2]) {
          return match;
        }
      }
    }
    return void 0;
  }
  const segment = segments[index2];
  if (node.static) {
    const staticChild = node.static[segment];
    if (staticChild) {
      const match = _lookupTree(ctx, staticChild, method, segments, index2 + 1);
      if (match) {
        return match;
      }
    }
  }
  if (node.param) {
    const match = _lookupTree(ctx, node.param, method, segments, index2 + 1);
    if (match) {
      return match;
    }
  }
  if (node.wildcard && node.wildcard.methods) {
    return node.wildcard.methods[method] || node.wildcard.methods[""];
  }
  return;
}
__name(_lookupTree, "_lookupTree");
function findAllRoutes(ctx, method = "", path2, opts) {
  if (path2[path2.length - 1] === "/") {
    path2 = path2.slice(0, -1);
  }
  const segments = splitPath(path2);
  const matches = _findAll(ctx, ctx.root, method, segments, 0);
  return matches.map((m) => {
    return {
      data: m.data,
      params: m.paramsMap ? getMatchParams(segments, m.paramsMap) : void 0
    };
  });
}
__name(findAllRoutes, "findAllRoutes");
function _findAll(ctx, node, method, segments, index2, matches = []) {
  var _a2;
  const segment = segments[index2];
  if (node.wildcard && node.wildcard.methods) {
    const match = node.wildcard.methods[method] || node.wildcard.methods[""];
    if (match) {
      matches.push(...match);
    }
  }
  if (node.param) {
    _findAll(ctx, node.param, method, segments, index2 + 1, matches);
    if (index2 === segments.length && node.param.methods) {
      const match = node.param.methods[method] || node.param.methods[""];
      if (match) {
        matches.push(...match);
      }
    }
  }
  const staticChild = (_a2 = node.static) == null ? void 0 : _a2[segment];
  if (staticChild) {
    _findAll(ctx, staticChild, method, segments, index2 + 1, matches);
  }
  if (index2 === segments.length && node.methods) {
    const match = node.methods[method] || node.methods[""];
    if (match) {
      matches.push(...match);
    }
  }
  return matches;
}
__name(_findAll, "_findAll");
var __defProp2 = Object.defineProperty;
var __export = /* @__PURE__ */ __name((target, all) => {
  for (var name in all)
    __defProp2(target, name, { get: all[name], enumerable: true });
}, "__export");
function isErrorStackTraceLimitWritable() {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === void 0) {
    return Object.isExtensible(Error);
  }
  return Object.prototype.hasOwnProperty.call(desc, "writable") ? desc.writable : desc.set !== void 0;
}
__name(isErrorStackTraceLimitWritable, "isErrorStackTraceLimitWritable");
function hideInternalStackFrames(stack) {
  const lines = stack.split("\n    at ");
  if (lines.length <= 1) {
    return stack;
  }
  lines.splice(1, 1);
  return lines.join("\n    at ");
}
__name(hideInternalStackFrames, "hideInternalStackFrames");
function makeErrorForHideStackFrame(Base, clazz) {
  var _hiddenStack;
  const _HideStackFramesError = class _HideStackFramesError extends Base {
    constructor(...args2) {
      var __super = (...args) => {
        super(...args);
        __privateAdd(this, _hiddenStack);
        return this;
      };
      if (isErrorStackTraceLimitWritable()) {
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 0;
        __super(...args2);
        Error.stackTraceLimit = limit;
      } else {
        __super(...args2);
      }
      const stack = new Error().stack;
      if (stack) {
        __privateSet(this, _hiddenStack, hideInternalStackFrames(stack.replace(/^Error/, this.name)));
      }
    }
    // use `getter` here to avoid the stack trace being captured by loggers
    get errorStack() {
      return __privateGet(this, _hiddenStack);
    }
  };
  _hiddenStack = new WeakMap();
  __name(_HideStackFramesError, "HideStackFramesError");
  let HideStackFramesError = _HideStackFramesError;
  Object.defineProperty(HideStackFramesError.prototype, "constructor", {
    get() {
      return clazz;
    },
    enumerable: false,
    configurable: true
  });
  return HideStackFramesError;
}
__name(makeErrorForHideStackFrame, "makeErrorForHideStackFrame");
var _statusCode = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  TEMPORARY_REDIRECT: 307,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  "I'M_A_TEAPOT": 418,
  MISDIRECTED_REQUEST: 421,
  UNPROCESSABLE_ENTITY: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511
};
var InternalAPIError = (_a = class extends Error {
  constructor(status = "INTERNAL_SERVER_ERROR", body = void 0, headers = {}, statusCode = typeof status === "number" ? status : _statusCode[status]) {
    var _a2;
    super(
      body == null ? void 0 : body.message,
      (body == null ? void 0 : body.cause) ? {
        cause: body.cause
      } : void 0
    );
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.statusCode = statusCode;
    this.name = "APIError";
    this.status = status;
    this.headers = headers;
    this.statusCode = statusCode;
    this.body = body ? {
      code: (_a2 = body == null ? void 0 : body.message) == null ? void 0 : _a2.toUpperCase().replace(/ /g, "_").replace(/[^A-Z0-9_]/g, ""),
      ...body
    } : void 0;
  }
}, __name(_a, "InternalAPIError"), _a);
var APIError = makeErrorForHideStackFrame(InternalAPIError, Error);
async function getBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!request.body) {
    return void 0;
  }
  if (contentType.includes("application/json")) {
    return await request.json();
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const result = {};
    formData.forEach((value, key) => {
      result[key] = value.toString();
    });
    return result;
  }
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const result = {};
    formData.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (contentType.includes("text/plain")) {
    return await request.text();
  }
  if (contentType.includes("application/octet-stream")) {
    return await request.arrayBuffer();
  }
  if (contentType.includes("application/pdf") || contentType.includes("image/") || contentType.includes("video/")) {
    const blob = await request.blob();
    return blob;
  }
  if (contentType.includes("application/stream") || request.body instanceof ReadableStream) {
    return request.body;
  }
  return await request.text();
}
__name(getBody, "getBody");
function isAPIError(error) {
  return error instanceof APIError || (error == null ? void 0 : error.name) === "APIError";
}
__name(isAPIError, "isAPIError");
function tryDecode(str) {
  try {
    return str.includes("%") ? decodeURIComponent(str) : str;
  } catch {
    return str;
  }
}
__name(tryDecode, "tryDecode");
function isJSONSerializable(value) {
  if (value === void 0) {
    return false;
  }
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === null) {
    return true;
  }
  if (t !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  if (value.buffer) {
    return false;
  }
  return value.constructor && value.constructor.name === "Object" || typeof value.toJSON === "function";
}
__name(isJSONSerializable, "isJSONSerializable");
function safeStringify(obj, replacer, space) {
  let id = 0;
  const seen = /* @__PURE__ */ new WeakMap();
  const safeReplacer = /* @__PURE__ */ __name((key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return `[Circular ref-${seen.get(value)}]`;
      }
      seen.set(value, id++);
    }
    return value;
  }, "safeReplacer");
  return JSON.stringify(obj, safeReplacer, space);
}
__name(safeStringify, "safeStringify");
function isJSONResponse(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "_flag" in value && value._flag === "json";
}
__name(isJSONResponse, "isJSONResponse");
function toResponse(data, init) {
  if (data instanceof Response) {
    if ((init == null ? void 0 : init.headers) instanceof Headers) {
      init.headers.forEach((value, key) => {
        data.headers.set(key, value);
      });
    }
    return data;
  }
  const isJSON = isJSONResponse(data);
  if (isJSON) {
    const body2 = data.body;
    const routerResponse = data.routerResponse;
    if (routerResponse instanceof Response) {
      return routerResponse;
    }
    const headers2 = new Headers({
      ...routerResponse == null ? void 0 : routerResponse.headers,
      ...data.headers,
      ...init == null ? void 0 : init.headers,
      "Content-Type": "application/json"
    });
    return new Response(JSON.stringify(body2), {
      ...routerResponse,
      headers: headers2,
      status: data.status ?? (init == null ? void 0 : init.status) ?? (routerResponse == null ? void 0 : routerResponse.status),
      statusText: (init == null ? void 0 : init.statusText) ?? (routerResponse == null ? void 0 : routerResponse.statusText)
    });
  }
  if (isAPIError(data)) {
    return toResponse(data.body, {
      status: (init == null ? void 0 : init.status) ?? data.statusCode,
      statusText: data.status.toString(),
      headers: (init == null ? void 0 : init.headers) || data.headers
    });
  }
  let body = data;
  let headers = new Headers(init == null ? void 0 : init.headers);
  if (!data) {
    if (data === null) {
      body = JSON.stringify(null);
    }
    headers.set("content-type", "application/json");
  } else if (typeof data === "string") {
    body = data;
    headers.set("Content-Type", "text/plain");
  } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    body = data;
    headers.set("Content-Type", "application/octet-stream");
  } else if (data instanceof Blob) {
    body = data;
    headers.set("Content-Type", data.type || "application/octet-stream");
  } else if (data instanceof FormData) {
    body = data;
  } else if (data instanceof URLSearchParams) {
    body = data;
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  } else if (data instanceof ReadableStream) {
    body = data;
    headers.set("Content-Type", "application/octet-stream");
  } else if (isJSONSerializable(data)) {
    body = safeStringify(data);
    headers.set("Content-Type", "application/json");
  }
  return new Response(body, {
    ...init,
    headers
  });
}
__name(toResponse, "toResponse");
async function runValidation(options, context = {}) {
  let request = {
    body: context.body,
    query: context.query
  };
  if (options.body) {
    const result = await options.body["~standard"].validate(context.body);
    if (result.issues) {
      return {
        data: null,
        error: fromError(result.issues, "body")
      };
    }
    request.body = result.value;
  }
  if (options.query) {
    const result = await options.query["~standard"].validate(context.query);
    if (result.issues) {
      return {
        data: null,
        error: fromError(result.issues, "query")
      };
    }
    request.query = result.value;
  }
  if (options.requireHeaders && !context.headers) {
    return {
      data: null,
      error: { message: "Headers is required" }
    };
  }
  if (options.requireRequest && !context.request) {
    return {
      data: null,
      error: { message: "Request is required" }
    };
  }
  return {
    data: request,
    error: null
  };
}
__name(runValidation, "runValidation");
function fromError(error, validating) {
  for (const issue2 of error) {
    issue2.message;
  }
  return {
    message: `Invalid ${validating} parameters`
  };
}
__name(fromError, "fromError");
var algorithm = { name: "HMAC", hash: "SHA-256" };
var getCryptoKey = /* @__PURE__ */ __name(async (secret) => {
  const secretBuf = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  return await getWebcryptoSubtle().importKey("raw", secretBuf, algorithm, false, [
    "sign",
    "verify"
  ]);
}, "getCryptoKey");
var verifySignature = /* @__PURE__ */ __name(async (base64Signature, value, secret) => {
  try {
    const signatureBinStr = atob(base64Signature);
    const signature = new Uint8Array(signatureBinStr.length);
    for (let i = 0, len = signatureBinStr.length; i < len; i++) {
      signature[i] = signatureBinStr.charCodeAt(i);
    }
    return await getWebcryptoSubtle().verify(
      algorithm,
      secret,
      signature,
      new TextEncoder().encode(value)
    );
  } catch (e) {
    return false;
  }
}, "verifySignature");
var makeSignature = /* @__PURE__ */ __name(async (value, secret) => {
  const key = await getCryptoKey(secret);
  const signature = await getWebcryptoSubtle().sign(
    algorithm.name,
    key,
    new TextEncoder().encode(value)
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}, "makeSignature");
var signCookieValue = /* @__PURE__ */ __name(async (value, secret) => {
  const signature = await makeSignature(value, secret);
  value = `${value}.${signature}`;
  value = encodeURIComponent(value);
  return value;
}, "signCookieValue");
var getCookieKey = /* @__PURE__ */ __name((key, prefix) => {
  let finalKey = key;
  if (prefix) {
    if (prefix === "secure") {
      finalKey = "__Secure-" + key;
    } else if (prefix === "host") {
      finalKey = "__Host-" + key;
    } else {
      return void 0;
    }
  }
  return finalKey;
}, "getCookieKey");
function parseCookies(str) {
  if (typeof str !== "string") {
    throw new TypeError("argument str must be a string");
  }
  const cookies = /* @__PURE__ */ new Map();
  let index2 = 0;
  while (index2 < str.length) {
    const eqIdx = str.indexOf("=", index2);
    if (eqIdx === -1) {
      break;
    }
    let endIdx = str.indexOf(";", index2);
    if (endIdx === -1) {
      endIdx = str.length;
    } else if (endIdx < eqIdx) {
      index2 = str.lastIndexOf(";", eqIdx - 1) + 1;
      continue;
    }
    const key = str.slice(index2, eqIdx).trim();
    if (!cookies.has(key)) {
      let val = str.slice(eqIdx + 1, endIdx).trim();
      if (val.codePointAt(0) === 34) {
        val = val.slice(1, -1);
      }
      cookies.set(key, tryDecode(val));
    }
    index2 = endIdx + 1;
  }
  return cookies;
}
__name(parseCookies, "parseCookies");
var _serialize = /* @__PURE__ */ __name((key, value, opt = {}) => {
  let cookie;
  if ((opt == null ? void 0 : opt.prefix) === "secure") {
    cookie = `${`__Secure-${key}`}=${value}`;
  } else if ((opt == null ? void 0 : opt.prefix) === "host") {
    cookie = `${`__Host-${key}`}=${value}`;
  } else {
    cookie = `${key}=${value}`;
  }
  if (key.startsWith("__Secure-") && !opt.secure) {
    opt.secure = true;
  }
  if (key.startsWith("__Host-")) {
    if (!opt.secure) {
      opt.secure = true;
    }
    if (opt.path !== "/") {
      opt.path = "/";
    }
    if (opt.domain) {
      opt.domain = void 0;
    }
  }
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4) {
      throw new Error(
        "Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration."
      );
    }
    cookie += `; Max-Age=${Math.floor(opt.maxAge)}`;
  }
  if (opt.domain && opt.prefix !== "host") {
    cookie += `; Domain=${opt.domain}`;
  }
  if (opt.path) {
    cookie += `; Path=${opt.path}`;
  }
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7) {
      throw new Error(
        "Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future."
      );
    }
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) {
    cookie += "; HttpOnly";
  }
  if (opt.secure) {
    cookie += "; Secure";
  }
  if (opt.sameSite) {
    cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  }
  if (opt.partitioned) {
    if (!opt.secure) {
      opt.secure = true;
    }
    cookie += "; Partitioned";
  }
  return cookie;
}, "_serialize");
var serializeCookie = /* @__PURE__ */ __name((key, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(key, value, opt);
}, "serializeCookie");
var serializeSignedCookie = /* @__PURE__ */ __name(async (key, value, secret, opt) => {
  value = await signCookieValue(value, secret);
  return _serialize(key, value, opt);
}, "serializeSignedCookie");
var createInternalContext = /* @__PURE__ */ __name(async (context, {
  options,
  path: path2
}) => {
  const headers = new Headers();
  const { data, error } = await runValidation(options, context);
  if (error) {
    throw new APIError(400, {
      message: error.message,
      code: "VALIDATION_ERROR"
    });
  }
  const requestHeaders = "headers" in context ? context.headers instanceof Headers ? context.headers : new Headers(context.headers) : "request" in context && context.request instanceof Request ? context.request.headers : null;
  const requestCookies = requestHeaders == null ? void 0 : requestHeaders.get("cookie");
  const parsedCookies = requestCookies ? parseCookies(requestCookies) : void 0;
  const internalContext = {
    ...context,
    body: data.body,
    query: data.query,
    path: context.path || path2,
    context: "context" in context && context.context ? context.context : {},
    returned: void 0,
    headers: context == null ? void 0 : context.headers,
    request: context == null ? void 0 : context.request,
    params: "params" in context ? context.params : void 0,
    method: context.method,
    setHeader: /* @__PURE__ */ __name((key, value) => {
      headers.set(key, value);
    }, "setHeader"),
    getHeader: /* @__PURE__ */ __name((key) => {
      if (!requestHeaders) return null;
      return requestHeaders.get(key);
    }, "getHeader"),
    getCookie: /* @__PURE__ */ __name((key, prefix) => {
      const finalKey = getCookieKey(key, prefix);
      if (!finalKey) {
        return null;
      }
      return (parsedCookies == null ? void 0 : parsedCookies.get(finalKey)) || null;
    }, "getCookie"),
    getSignedCookie: /* @__PURE__ */ __name(async (key, secret, prefix) => {
      const finalKey = getCookieKey(key, prefix);
      if (!finalKey) {
        return null;
      }
      const value = parsedCookies == null ? void 0 : parsedCookies.get(finalKey);
      if (!value) {
        return null;
      }
      const signatureStartPos = value.lastIndexOf(".");
      if (signatureStartPos < 1) {
        return null;
      }
      const signedValue = value.substring(0, signatureStartPos);
      const signature = value.substring(signatureStartPos + 1);
      if (signature.length !== 44 || !signature.endsWith("=")) {
        return null;
      }
      const secretKey = await getCryptoKey(secret);
      const isVerified = await verifySignature(signature, signedValue, secretKey);
      return isVerified ? signedValue : false;
    }, "getSignedCookie"),
    setCookie: /* @__PURE__ */ __name((key, value, options2) => {
      const cookie = serializeCookie(key, value, options2);
      headers.append("set-cookie", cookie);
      return cookie;
    }, "setCookie"),
    setSignedCookie: /* @__PURE__ */ __name(async (key, value, secret, options2) => {
      const cookie = await serializeSignedCookie(key, value, secret, options2);
      headers.append("set-cookie", cookie);
      return cookie;
    }, "setSignedCookie"),
    redirect: /* @__PURE__ */ __name((url) => {
      headers.set("location", url);
      return new APIError("FOUND", void 0, headers);
    }, "redirect"),
    error: /* @__PURE__ */ __name((status, body, headers2) => {
      return new APIError(status, body, headers2);
    }, "error"),
    json: /* @__PURE__ */ __name((json, routerResponse) => {
      if (!context.asResponse) {
        return json;
      }
      return {
        body: (routerResponse == null ? void 0 : routerResponse.body) || json,
        routerResponse,
        _flag: "json"
      };
    }, "json"),
    responseHeaders: headers
  };
  for (const middleware of options.use || []) {
    const response = await middleware({
      ...internalContext,
      returnHeaders: true,
      asResponse: false
    });
    if (response.response) {
      Object.assign(internalContext.context, response.response);
    }
    if (response.headers) {
      response.headers.forEach((value, key) => {
        internalContext.responseHeaders.set(key, value);
      });
    }
  }
  return internalContext;
}, "createInternalContext");
var createEndpoint2 = /* @__PURE__ */ __name((path2, options, handler) => {
  const internalHandler = /* @__PURE__ */ __name(async (...inputCtx) => {
    const context = inputCtx[0] || {};
    const internalContext = await createInternalContext(context, {
      options,
      path: path2
    });
    const response = await handler(internalContext).catch(async (e) => {
      if (isAPIError(e)) {
        const onAPIError = options.onAPIError;
        if (onAPIError) {
          await onAPIError(e);
        }
        if (context.asResponse) {
          return e;
        }
      }
      throw e;
    });
    const headers = internalContext.responseHeaders;
    return context.asResponse ? toResponse(response, {
      headers
    }) : context.returnHeaders ? {
      headers,
      response
    } : response;
  }, "internalHandler");
  internalHandler.options = options;
  internalHandler.path = path2;
  return internalHandler;
}, "createEndpoint2");
createEndpoint2.create = (opts) => {
  return (path2, options, handler) => {
    return createEndpoint2(
      path2,
      {
        ...options,
        use: [...(options == null ? void 0 : options.use) || [], ...(opts == null ? void 0 : opts.use) || []]
      },
      handler
    );
  };
};
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, params) {
  function init(inst, def) {
    var _a2;
    Object.defineProperty(inst, "_zod", {
      value: inst._zod ?? {},
      enumerable: false
    });
    (_a2 = inst._zod).traits ?? (_a2.traits = /* @__PURE__ */ new Set());
    inst._zod.traits.add(name);
    initializer3(inst, def);
    for (const k in _.prototype) {
      if (!(k in inst))
        Object.defineProperty(inst, k, { value: _.prototype[k].bind(inst) });
    }
    inst._zod.constr = _;
    inst._zod.def = def;
  }
  __name(init, "init");
  const Parent = (params == null ? void 0 : params.Parent) ?? Object;
  const _Definition = class _Definition extends Parent {
  };
  __name(_Definition, "Definition");
  let Definition = _Definition;
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a2;
    const inst = (params == null ? void 0 : params.Parent) ? new Definition() : this;
    init(inst, def);
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  __name(_, "_");
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: /* @__PURE__ */ __name((inst) => {
      var _a2, _b2;
      if ((params == null ? void 0 : params.Parent) && inst instanceof params.Parent)
        return true;
      return (_b2 = (_a2 = inst == null ? void 0 : inst._zod) == null ? void 0 : _a2.traits) == null ? void 0 : _b2.has(name);
    }, "value")
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
__name($constructor, "$constructor");
var $ZodAsyncError = (_b = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}, __name(_b, "$ZodAsyncError"), _b);
var globalConfig = {};
function config(newConfig) {
  return globalConfig;
}
__name(config, "config");
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: /* @__PURE__ */ __name(() => BIGINT_FORMAT_RANGES, "BIGINT_FORMAT_RANGES"),
  Class: /* @__PURE__ */ __name(() => Class, "Class"),
  NUMBER_FORMAT_RANGES: /* @__PURE__ */ __name(() => NUMBER_FORMAT_RANGES, "NUMBER_FORMAT_RANGES"),
  aborted: /* @__PURE__ */ __name(() => aborted, "aborted"),
  allowsEval: /* @__PURE__ */ __name(() => allowsEval, "allowsEval"),
  assert: /* @__PURE__ */ __name(() => assert, "assert"),
  assertEqual: /* @__PURE__ */ __name(() => assertEqual, "assertEqual"),
  assertIs: /* @__PURE__ */ __name(() => assertIs, "assertIs"),
  assertNever: /* @__PURE__ */ __name(() => assertNever, "assertNever"),
  assertNotEqual: /* @__PURE__ */ __name(() => assertNotEqual, "assertNotEqual"),
  assignProp: /* @__PURE__ */ __name(() => assignProp, "assignProp"),
  cached: /* @__PURE__ */ __name(() => cached, "cached"),
  captureStackTrace: /* @__PURE__ */ __name(() => captureStackTrace, "captureStackTrace"),
  cleanEnum: /* @__PURE__ */ __name(() => cleanEnum, "cleanEnum"),
  cleanRegex: /* @__PURE__ */ __name(() => cleanRegex, "cleanRegex"),
  clone: /* @__PURE__ */ __name(() => clone, "clone"),
  createTransparentProxy: /* @__PURE__ */ __name(() => createTransparentProxy, "createTransparentProxy"),
  defineLazy: /* @__PURE__ */ __name(() => defineLazy, "defineLazy"),
  esc: /* @__PURE__ */ __name(() => esc, "esc"),
  escapeRegex: /* @__PURE__ */ __name(() => escapeRegex, "escapeRegex"),
  extend: /* @__PURE__ */ __name(() => extend, "extend"),
  finalizeIssue: /* @__PURE__ */ __name(() => finalizeIssue, "finalizeIssue"),
  floatSafeRemainder: /* @__PURE__ */ __name(() => floatSafeRemainder, "floatSafeRemainder"),
  getElementAtPath: /* @__PURE__ */ __name(() => getElementAtPath, "getElementAtPath"),
  getEnumValues: /* @__PURE__ */ __name(() => getEnumValues, "getEnumValues"),
  getLengthableOrigin: /* @__PURE__ */ __name(() => getLengthableOrigin, "getLengthableOrigin"),
  getParsedType: /* @__PURE__ */ __name(() => getParsedType, "getParsedType"),
  getSizableOrigin: /* @__PURE__ */ __name(() => getSizableOrigin, "getSizableOrigin"),
  isObject: /* @__PURE__ */ __name(() => isObject, "isObject"),
  isPlainObject: /* @__PURE__ */ __name(() => isPlainObject, "isPlainObject"),
  issue: /* @__PURE__ */ __name(() => issue, "issue"),
  joinValues: /* @__PURE__ */ __name(() => joinValues, "joinValues"),
  jsonStringifyReplacer: /* @__PURE__ */ __name(() => jsonStringifyReplacer, "jsonStringifyReplacer"),
  merge: /* @__PURE__ */ __name(() => merge, "merge"),
  normalizeParams: /* @__PURE__ */ __name(() => normalizeParams, "normalizeParams"),
  nullish: /* @__PURE__ */ __name(() => nullish, "nullish"),
  numKeys: /* @__PURE__ */ __name(() => numKeys, "numKeys"),
  omit: /* @__PURE__ */ __name(() => omit, "omit"),
  optionalKeys: /* @__PURE__ */ __name(() => optionalKeys, "optionalKeys"),
  partial: /* @__PURE__ */ __name(() => partial, "partial"),
  pick: /* @__PURE__ */ __name(() => pick, "pick"),
  prefixIssues: /* @__PURE__ */ __name(() => prefixIssues, "prefixIssues"),
  primitiveTypes: /* @__PURE__ */ __name(() => primitiveTypes, "primitiveTypes"),
  promiseAllObject: /* @__PURE__ */ __name(() => promiseAllObject, "promiseAllObject"),
  propertyKeyTypes: /* @__PURE__ */ __name(() => propertyKeyTypes, "propertyKeyTypes"),
  randomString: /* @__PURE__ */ __name(() => randomString, "randomString"),
  required: /* @__PURE__ */ __name(() => required, "required"),
  stringifyPrimitive: /* @__PURE__ */ __name(() => stringifyPrimitive, "stringifyPrimitive"),
  unwrapMessage: /* @__PURE__ */ __name(() => unwrapMessage, "unwrapMessage")
});
function assertEqual(val) {
  return val;
}
__name(assertEqual, "assertEqual");
function assertNotEqual(val) {
  return val;
}
__name(assertNotEqual, "assertNotEqual");
function assertIs(_arg) {
}
__name(assertIs, "assertIs");
function assertNever(_x) {
  throw new Error();
}
__name(assertNever, "assertNever");
function assert(_) {
}
__name(assert, "assert");
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
__name(getEnumValues, "getEnumValues");
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
__name(joinValues, "joinValues");
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
__name(jsonStringifyReplacer, "jsonStringifyReplacer");
function cached(getter) {
  return {
    get value() {
      {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
    }
  };
}
__name(cached, "cached");
function nullish(input) {
  return input === null || input === void 0;
}
__name(nullish, "nullish");
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
__name(cleanRegex, "cleanRegex");
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
__name(floatSafeRemainder, "floatSafeRemainder");
function defineLazy(object, key, getter) {
  Object.defineProperty(object, key, {
    get() {
      {
        const value = getter();
        object[key] = value;
        return value;
      }
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
__name(defineLazy, "defineLazy");
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
__name(assignProp, "assignProp");
function getElementAtPath(obj, path2) {
  if (!path2)
    return obj;
  return path2.reduce((acc, key) => acc == null ? void 0 : acc[key], obj);
}
__name(getElementAtPath, "getElementAtPath");
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
__name(promiseAllObject, "promiseAllObject");
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
__name(randomString, "randomString");
function esc(str) {
  return JSON.stringify(str);
}
__name(esc, "esc");
var captureStackTrace = Error.captureStackTrace ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
__name(isObject, "isObject");
var allowsEval = cached(() => {
  var _a2;
  if (typeof navigator !== "undefined" && ((_a2 = navigator == null ? void 0 : navigator.userAgent) == null ? void 0 : _a2.includes("Cloudflare"))) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
__name(isPlainObject, "isPlainObject");
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
__name(numKeys, "numKeys");
var getParsedType = /* @__PURE__ */ __name((data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
}, "getParsedType");
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegex, "escapeRegex");
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || (params == null ? void 0 : params.parent))
    cl._zod.parent = inst;
  return cl;
}
__name(clone, "clone");
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: /* @__PURE__ */ __name(() => params, "error") };
  if ((params == null ? void 0 : params.message) !== void 0) {
    if ((params == null ? void 0 : params.error) !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: /* @__PURE__ */ __name(() => params.error, "error") };
  return params;
}
__name(normalizeParams, "normalizeParams");
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
__name(createTransparentProxy, "createTransparentProxy");
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
__name(stringifyPrimitive, "stringifyPrimitive");
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
__name(optionalKeys, "optionalKeys");
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const newShape = {};
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    newShape[key] = currDef.shape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
__name(pick, "pick");
function omit(schema, mask) {
  const newShape = { ...schema._zod.def.shape };
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    delete newShape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
__name(omit, "omit");
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const def = {
    ...schema._zod.def,
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    checks: []
    // delete existing checks
  };
  return clone(schema, def);
}
__name(extend, "extend");
function merge(a, b) {
  return clone(a, {
    ...a._zod.def,
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    catchall: b._zod.def.catchall,
    checks: []
    // delete existing checks
  });
}
__name(merge, "merge");
function partial(Class2, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in oldShape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = Class2 ? new Class2({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  } else {
    for (const key in oldShape) {
      shape[key] = Class2 ? new Class2({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    checks: []
  });
}
__name(partial, "partial");
function required(Class2, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in shape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = new Class2({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  } else {
    for (const key in oldShape) {
      shape[key] = new Class2({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    // optional: [],
    checks: []
  });
}
__name(required, "required");
function aborted(x, startIndex = 0) {
  var _a2;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (((_a2 = x.issues[i]) == null ? void 0 : _a2.continue) !== true)
      return true;
  }
  return false;
}
__name(aborted, "aborted");
function prefixIssues(path2, issues) {
  return issues.map((iss) => {
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path2);
    return iss;
  });
}
__name(prefixIssues, "prefixIssues");
function unwrapMessage(message) {
  return typeof message === "string" ? message : message == null ? void 0 : message.message;
}
__name(unwrapMessage, "unwrapMessage");
function finalizeIssue(iss, ctx, config2) {
  var _a2, _b2, _c2, _d2, _e2, _f;
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage((_c2 = (_b2 = (_a2 = iss.inst) == null ? void 0 : _a2._zod.def) == null ? void 0 : _b2.error) == null ? void 0 : _c2.call(_b2, iss)) ?? unwrapMessage((_d2 = ctx == null ? void 0 : ctx.error) == null ? void 0 : _d2.call(ctx, iss)) ?? unwrapMessage((_e2 = config2.customError) == null ? void 0 : _e2.call(config2, iss)) ?? unwrapMessage((_f = config2.localeError) == null ? void 0 : _f.call(config2, iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!(ctx == null ? void 0 : ctx.reportInput)) {
    delete full.input;
  }
  return full;
}
__name(finalizeIssue, "finalizeIssue");
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
__name(getSizableOrigin, "getSizableOrigin");
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
__name(getLengthableOrigin, "getLengthableOrigin");
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
__name(issue, "issue");
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
__name(cleanEnum, "cleanEnum");
var Class = (_c = class {
  constructor(..._args) {
  }
}, __name(_c, "Class"), _c);
var initializer = /* @__PURE__ */ __name((inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  Object.defineProperty(inst, "message", {
    get() {
      return JSON.stringify(def, jsonStringifyReplacer, 2);
    },
    enumerable: true
    // configurable: false,
  });
  Object.defineProperty(inst, "toString", {
    value: /* @__PURE__ */ __name(() => inst.message, "value"),
    enumerable: false
  });
}, "initializer");
var $ZodError = /* @__PURE__ */ $constructor("$ZodError", initializer);
var $ZodRealError = /* @__PURE__ */ $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
__name(flattenError, "flattenError");
function formatError(error, _mapper) {
  const mapper = _mapper || function(issue2) {
    return issue2.message;
  };
  const fieldErrors = { _errors: [] };
  const processError = /* @__PURE__ */ __name((error2) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues });
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues });
      } else if (issue2.path.length === 0) {
        fieldErrors._errors.push(mapper(issue2));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue2.path.length) {
          const el = issue2.path[i];
          const terminal = i === issue2.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue2));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  }, "processError");
  processError(error);
  return fieldErrors;
}
__name(formatError, "formatError");
var _parse = /* @__PURE__ */ __name((_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new ((_params == null ? void 0 : _params.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params == null ? void 0 : _params.callee);
    throw e;
  }
  return result.value;
}, "_parse");
var _parseAsync = /* @__PURE__ */ __name((_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new ((params == null ? void 0 : params.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params == null ? void 0 : params.callee);
    throw e;
  }
  return result.value;
}, "_parseAsync");
var _safeParse = /* @__PURE__ */ __name((_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
}, "_safeParse");
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = /* @__PURE__ */ __name((_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
}, "_safeParseAsync");
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});
var Doc = (_d = class {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this == null ? void 0 : this.args;
    const content = (this == null ? void 0 : this.content) ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
}, __name(_d, "Doc"), _d);
var version = {
  major: 4,
  minor: 0,
  patch: 0
};
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  var _a2;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    (_a3 = inst._zod.deferred) == null ? void 0 : _a3.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = /* @__PURE__ */ __name((payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && (ctx == null ? void 0 : ctx.async) === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    }, "runChecks");
    inst._zod.run = (payload, ctx) => {
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  inst["~standard"] = {
    validate: /* @__PURE__ */ __name((value) => {
      var _a4;
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: (_a4 = r.error) == null ? void 0 : _a4.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => {
          var _a5;
          return r.success ? { value: r.data } : { issues: (_a5 = r.error) == null ? void 0 : _a5.issues };
        });
      }
    }, "validate"),
    vendor: "zod",
    version: 1
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index2) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index2, result.issues));
  }
  final.value[index2] = result.value;
}
__name(handleArrayResult, "handleArrayResult");
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handleObjectResult(result, final, key) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(key, result.issues));
  }
  final.value[key] = result.value;
}
__name(handleObjectResult, "handleObjectResult");
function handleOptionalObjectResult(result, final, key, input) {
  if (result.issues.length) {
    if (input[key] === void 0) {
      if (key in input) {
        final.value[key] = void 0;
      } else {
        final.value[key] = result.value;
      }
    } else {
      final.issues.push(...prefixIssues(key, result.issues));
    }
  } else if (result.value === void 0) {
    if (key in input)
      final.value[key] = void 0;
  } else {
    final.value[key] = result.value;
  }
}
__name(handleOptionalObjectResult, "handleOptionalObjectResult");
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const _normalized = cached(() => {
    const keys = Object.keys(def.shape);
    for (const k of keys) {
      if (!(def.shape[k] instanceof $ZodType)) {
        throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
      }
    }
    const okeys = optionalKeys(def.shape);
    return {
      shape: def.shape,
      keys,
      keySet: new Set(keys),
      numKeys: keys.length,
      optionalKeys: new Set(okeys)
    };
  });
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const generateFastpass = /* @__PURE__ */ __name((shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = /* @__PURE__ */ __name((key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    }, "parseStr");
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {}`);
    for (const key of normalized.keys) {
      if (normalized.optionalKeys.has(key)) {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        const k = esc(key);
        doc.write(`
        if (${id}.issues.length) {
          if (input[${k}] === undefined) {
            if (${k} in input) {
              newResult[${k}] = undefined;
            }
          } else {
            payload.issues = payload.issues.concat(
              ${id}.issues.map((iss) => ({
                ...iss,
                path: iss.path ? [${k}, ...iss.path] : [${k}],
              }))
            );
          }
        } else if (${id}.value === undefined) {
          if (${k} in input) newResult[${k}] = undefined;
        } else {
          newResult[${k}] = ${id}.value;
        }
        `);
      } else {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        doc.write(`
          if (${id}.issues.length) payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${esc(key)}, ...iss.path] : [${esc(key)}]
          })));`);
        doc.write(`newResult[${esc(key)}] = ${id}.value`);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  }, "generateFastpass");
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    if (jit && fastEnabled && (ctx == null ? void 0 : ctx.async) === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
    } else {
      payload.value = {};
      const shape = value.shape;
      for (const key of value.keys) {
        const el = shape[key];
        const r = el._zod.run({ value: input[key], issues: [] }, ctx);
        const isOptional = el._zod.optin === "optional" && el._zod.optout === "optional";
        if (r instanceof Promise) {
          proms.push(r.then((r2) => isOptional ? handleOptionalObjectResult(r2, payload, key, input) : handleObjectResult(r2, payload, key)));
        } else if (isOptional) {
          handleOptionalObjectResult(r, payload, key, input);
        } else {
          handleObjectResult(r, payload, key);
        }
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    const unrecognized = [];
    const keySet = value.keySet;
    const _catchall = catchall._zod;
    const t = _catchall.def.type;
    for (const key of Object.keys(input)) {
      if (keySet.has(key))
        continue;
      if (t === "never") {
        unrecognized.push(key);
        continue;
      }
      const r = _catchall.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handleObjectResult(r2, payload, key)));
      } else {
        handleObjectResult(r, payload, key);
      }
    }
    if (unrecognized.length) {
      payload.issues.push({
        code: "unrecognized_keys",
        keys: unrecognized,
        input,
        inst
      });
    }
    if (!proms.length)
      return payload;
    return Promise.all(proms).then(() => {
      return payload;
    });
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
__name(handleUnionResults, "handleUnionResults");
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index2 = 0; index2 < a.length; index2++) {
      const itemA = a[index2];
      const itemB = b[index2];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index2, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
__name(mergeValues, "mergeValues");
function handleIntersectionResults(result, left, right) {
  if (left.issues.length) {
    result.issues.push(...left.issues);
  }
  if (right.issues.length) {
    result.issues.push(...right.issues);
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
__name(handleIntersectionResults, "handleIntersectionResults");
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  inst._zod.values = new Set(values);
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const _out = def.transform(payload.value, payload);
    if (_ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
__name(handleDefaultResult, "handleDefaultResult");
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
__name(handleNonOptionalResult, "handleNonOptionalResult");
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def, ctx));
    }
    return handlePipeResult(left, def, ctx);
  };
});
function handlePipeResult(left, def, ctx) {
  if (aborted(left)) {
    return left;
  }
  return def.out._zod.run({ value: left.value, issues: left.issues }, ctx);
}
__name(handlePipeResult, "handlePipeResult");
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
__name(handleReadonlyResult, "handleReadonlyResult");
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
__name(handleRefineResult, "handleRefineResult");
var $ZodRegistry = (_e = class {
  constructor() {
    this._map = /* @__PURE__ */ new Map();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      if (this._idmap.has(meta.id)) {
        throw new Error(`ID ${meta.id} already exists in the registry`);
      }
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new Map();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      return { ...pm, ...this._map.get(schema) };
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}, __name(_e, "$ZodRegistry"), _e);
function registry() {
  return new $ZodRegistry();
}
__name(registry, "registry");
var globalRegistry = /* @__PURE__ */ registry();
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
__name(_unknown, "_unknown");
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
__name(_never, "_never");
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
__name(_maxLength, "_maxLength");
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
__name(_minLength, "_minLength");
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
__name(_length, "_length");
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
__name(_overwrite, "_overwrite");
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
__name(_array, "_array");
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
__name(_refine, "_refine");
var initializer2 = /* @__PURE__ */ __name((inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: /* @__PURE__ */ __name((mapper) => formatError(inst, mapper), "value")
      // enumerable: false,
    },
    flatten: {
      value: /* @__PURE__ */ __name((mapper) => flattenError(inst, mapper), "value")
      // enumerable: false,
    },
    addIssue: {
      value: /* @__PURE__ */ __name((issue2) => inst.issues.push(issue2), "value")
      // enumerable: false,
    },
    addIssues: {
      value: /* @__PURE__ */ __name((issues2) => inst.issues.push(...issues2), "value")
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
      // enumerable: false,
    }
  });
}, "initializer2");
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  inst.def = def;
  Object.defineProperty(inst, "_def", { value: def });
  inst.check = (...checks) => {
    return inst.clone(
      {
        ...def,
        checks: [
          ...def.checks ?? [],
          ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }
      // { parent: true }
    );
  };
  inst.clone = (def2, params) => clone(inst, def2, params);
  inst.brand = () => inst;
  inst.register = (reg, meta) => {
    reg.add(inst, meta);
    return inst;
  };
  inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.refine = (check2, params) => inst.check(refine(check2, params));
  inst.superRefine = (refinement) => inst.check(superRefine(refinement));
  inst.overwrite = (fn) => inst.check(_overwrite(fn));
  inst.optional = () => optional(inst);
  inst.nullable = () => nullable(inst);
  inst.nullish = () => optional(nullable(inst));
  inst.nonoptional = (params) => nonoptional(inst, params);
  inst.array = () => array(inst);
  inst.or = (arg) => union([inst, arg]);
  inst.and = (arg) => intersection(inst, arg);
  inst.transform = (tx) => pipe(inst, transform(tx));
  inst.default = (def2) => _default(inst, def2);
  inst.prefault = (def2) => prefault(inst, def2);
  inst.catch = (params) => _catch(inst, params);
  inst.pipe = (target) => pipe(inst, target);
  inst.readonly = () => readonly(inst);
  inst.describe = (description) => {
    const cl = inst.clone();
    globalRegistry.add(cl, { description });
    return cl;
  };
  Object.defineProperty(inst, "description", {
    get() {
      var _a2;
      return (_a2 = globalRegistry.get(inst)) == null ? void 0 : _a2.description;
    },
    configurable: true
  });
  inst.meta = (...args) => {
    if (args.length === 0) {
      return globalRegistry.get(inst);
    }
    const cl = inst.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  };
  inst.isOptional = () => inst.safeParse(void 0).success;
  inst.isNullable = () => inst.safeParse(null).success;
  return inst;
});
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
});
function unknown() {
  return _unknown(ZodUnknown);
}
__name(unknown, "unknown");
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
});
function never(params) {
  return _never(ZodNever, params);
}
__name(never, "never");
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst.element = def.element;
  inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
  inst.nonempty = (params) => inst.check(_minLength(1, params));
  inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
  inst.length = (len, params) => inst.check(_length(len, params));
  inst.unwrap = () => inst.element;
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
__name(array, "array");
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObject.init(inst, def);
  ZodType.init(inst, def);
  util_exports.defineLazy(inst, "shape", () => def.shape);
  inst.keyof = () => _enum(Object.keys(inst._zod.def.shape));
  inst.catchall = (catchall) => inst.clone({ ...inst._zod.def, catchall });
  inst.passthrough = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
  inst.strip = () => inst.clone({ ...inst._zod.def, catchall: void 0 });
  inst.extend = (incoming) => {
    return util_exports.extend(inst, incoming);
  };
  inst.merge = (other) => util_exports.merge(inst, other);
  inst.pick = (mask) => util_exports.pick(inst, mask);
  inst.omit = (mask) => util_exports.omit(inst, mask);
  inst.partial = (...args) => util_exports.partial(ZodOptional, inst, args[0]);
  inst.required = (...args) => util_exports.required(ZodNonOptional, inst, args[0]);
});
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
__name(union, "union");
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
__name(intersection, "intersection");
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
__name(_enum, "_enum");
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        _issue.continue ?? (_issue.continue = true);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
__name(transform, "transform");
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
__name(optional, "optional");
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
__name(nullable, "nullable");
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
__name(_default, "_default");
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
__name(prefault, "prefault");
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
__name(nonoptional, "nonoptional");
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
__name(_catch, "_catch");
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
__name(pipe, "pipe");
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
__name(readonly, "readonly");
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
    // ...util.normalizeParams(params),
  });
  ch._zod.check = fn;
  return ch;
}
__name(check, "check");
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
__name(refine, "refine");
function superRefine(fn) {
  const ch = check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
__name(superRefine, "superRefine");
var paths = {};
function getTypeFromZodType(zodType) {
  switch (zodType.constructor.name) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodObject":
      return "object";
    case "ZodArray":
      return "array";
    default:
      return "string";
  }
}
__name(getTypeFromZodType, "getTypeFromZodType");
function getParameters(options) {
  var _a2, _b2;
  const parameters = [];
  if ((_b2 = (_a2 = options.metadata) == null ? void 0 : _a2.openapi) == null ? void 0 : _b2.parameters) {
    parameters.push(...options.metadata.openapi.parameters);
    return parameters;
  }
  if (options.query instanceof ZodObject) {
    Object.entries(options.query.shape).forEach(([key, value]) => {
      if (value instanceof ZodObject) {
        parameters.push({
          name: key,
          in: "query",
          schema: {
            type: getTypeFromZodType(value),
            ..."minLength" in value && value.minLength ? {
              minLength: value.minLength
            } : {},
            description: value.description
          }
        });
      }
    });
  }
  return parameters;
}
__name(getParameters, "getParameters");
function getRequestBody(options) {
  var _a2, _b2;
  if ((_b2 = (_a2 = options.metadata) == null ? void 0 : _a2.openapi) == null ? void 0 : _b2.requestBody) {
    return options.metadata.openapi.requestBody;
  }
  if (!options.body) return void 0;
  if (options.body instanceof ZodObject || options.body instanceof ZodOptional) {
    const shape = options.body.shape;
    if (!shape) return void 0;
    const properties = {};
    const required2 = [];
    Object.entries(shape).forEach(([key, value]) => {
      if (value instanceof ZodObject) {
        properties[key] = {
          type: getTypeFromZodType(value),
          description: value.description
        };
        if (!(value instanceof ZodOptional)) {
          required2.push(key);
        }
      }
    });
    return {
      required: options.body instanceof ZodOptional ? false : options.body ? true : false,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties,
            required: required2
          }
        }
      }
    };
  }
  return void 0;
}
__name(getRequestBody, "getRequestBody");
function getResponse(responses) {
  return {
    "400": {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              message: {
                type: "string"
              }
            },
            required: ["message"]
          }
        }
      },
      description: "Bad Request. Usually due to missing parameters, or invalid parameters."
    },
    "401": {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              message: {
                type: "string"
              }
            },
            required: ["message"]
          }
        }
      },
      description: "Unauthorized. Due to missing or invalid authentication."
    },
    "403": {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              message: {
                type: "string"
              }
            }
          }
        }
      },
      description: "Forbidden. You do not have permission to access this resource or to perform this action."
    },
    "404": {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              message: {
                type: "string"
              }
            }
          }
        }
      },
      description: "Not Found. The requested resource was not found."
    },
    "429": {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              message: {
                type: "string"
              }
            }
          }
        }
      },
      description: "Too Many Requests. You have exceeded the rate limit. Try again later."
    },
    "500": {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              message: {
                type: "string"
              }
            }
          }
        }
      },
      description: "Internal Server Error. This is a problem with the server that you cannot fix."
    },
    ...responses
  };
}
__name(getResponse, "getResponse");
async function generator(endpoints, config2) {
  const components = {
    schemas: {}
  };
  Object.entries(endpoints).forEach(([_, value]) => {
    var _a2, _b2, _c2, _d2, _e2, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
    const options = value.options;
    if ((_a2 = options.metadata) == null ? void 0 : _a2.SERVER_ONLY) return;
    if (options.method === "GET") {
      paths[value.path] = {
        get: {
          tags: ["Default", ...((_c2 = (_b2 = options.metadata) == null ? void 0 : _b2.openapi) == null ? void 0 : _c2.tags) || []],
          description: (_e2 = (_d2 = options.metadata) == null ? void 0 : _d2.openapi) == null ? void 0 : _e2.description,
          operationId: (_g = (_f = options.metadata) == null ? void 0 : _f.openapi) == null ? void 0 : _g.operationId,
          security: [
            {
              bearerAuth: []
            }
          ],
          parameters: getParameters(options),
          responses: getResponse((_i = (_h = options.metadata) == null ? void 0 : _h.openapi) == null ? void 0 : _i.responses)
        }
      };
    }
    if (options.method === "POST") {
      const body = getRequestBody(options);
      paths[value.path] = {
        post: {
          tags: ["Default", ...((_k = (_j = options.metadata) == null ? void 0 : _j.openapi) == null ? void 0 : _k.tags) || []],
          description: (_m = (_l = options.metadata) == null ? void 0 : _l.openapi) == null ? void 0 : _m.description,
          operationId: (_o = (_n = options.metadata) == null ? void 0 : _n.openapi) == null ? void 0 : _o.operationId,
          security: [
            {
              bearerAuth: []
            }
          ],
          parameters: getParameters(options),
          ...body ? { requestBody: body } : {
            requestBody: {
              //set body none
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {}
                  }
                }
              }
            }
          },
          responses: getResponse((_q = (_p = options.metadata) == null ? void 0 : _p.openapi) == null ? void 0 : _q.responses)
        }
      };
    }
  });
  const res = {
    openapi: "3.1.1",
    info: {
      title: "Better Auth",
      description: "API Reference for your Better Auth Instance",
      version: "1.1.0"
    },
    components,
    security: [
      {
        apiKeyCookie: []
      }
    ],
    servers: [
      {
        url: config2 == null ? void 0 : config2.url
      }
    ],
    tags: [
      {
        name: "Default",
        description: "Default endpoints that are included with Better Auth by default. These endpoints are not part of any plugin."
      }
    ],
    paths
  };
  return res;
}
__name(generator, "generator");
var getHTML = /* @__PURE__ */ __name((apiReference, config2) => `<!doctype html>
<html>
  <head>
    <title>Scalar API Reference</title>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      type="application/json">
    ${JSON.stringify(apiReference)}
    <\/script>
	 <script>
      var configuration = {
	  	favicon: ${(config2 == null ? void 0 : config2.logo) ? `data:image/svg+xml;utf8,${encodeURIComponent(config2.logo)}` : void 0} ,
	   	theme: ${(config2 == null ? void 0 : config2.theme) || "saturn"},
        metaData: {
			title: ${(config2 == null ? void 0 : config2.title) || "Open API Reference"},
			description: ${(config2 == null ? void 0 : config2.description) || "Better Call Open API"},
		}
      }
      document.getElementById('api-reference').dataset.configuration =
        JSON.stringify(configuration)
    <\/script>
	  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"><\/script>
  </body>
</html>`, "getHTML");
var createRouter = /* @__PURE__ */ __name((endpoints, config2) => {
  var _a2, _b2, _c2, _d2, _e2, _f;
  if (!((_a2 = config2 == null ? void 0 : config2.openapi) == null ? void 0 : _a2.disabled)) {
    const openapi = {
      path: "/api/reference",
      ...config2 == null ? void 0 : config2.openapi
    };
    endpoints["openapi"] = createEndpoint2(
      openapi.path,
      {
        method: "GET"
      },
      async (c) => {
        const schema = await generator(endpoints);
        return new Response(getHTML(schema, openapi.scalar), {
          headers: {
            "Content-Type": "text/html"
          }
        });
      }
    );
  }
  const router = createRouter$1();
  const middlewareRouter = createRouter$1();
  for (const endpoint of Object.values(endpoints)) {
    if (!endpoint.options) {
      continue;
    }
    if ((_c2 = (_b2 = endpoint.options) == null ? void 0 : _b2.metadata) == null ? void 0 : _c2.SERVER_ONLY) continue;
    const methods = Array.isArray((_d2 = endpoint.options) == null ? void 0 : _d2.method) ? endpoint.options.method : [(_e2 = endpoint.options) == null ? void 0 : _e2.method];
    for (const method of methods) {
      addRoute(router, method, endpoint.path, endpoint);
    }
  }
  if ((_f = config2 == null ? void 0 : config2.routerMiddleware) == null ? void 0 : _f.length) {
    for (const { path: path2, middleware } of config2.routerMiddleware) {
      addRoute(middlewareRouter, "*", path2, middleware);
    }
  }
  const processRequest = /* @__PURE__ */ __name(async (request) => {
    const url = new URL(request.url);
    const path2 = (config2 == null ? void 0 : config2.basePath) ? url.pathname.split(config2.basePath).reduce((acc, curr, index2) => {
      if (index2 !== 0) {
        if (index2 > 1) {
          acc.push(`${config2.basePath}${curr}`);
        } else {
          acc.push(curr);
        }
      }
      return acc;
    }, []).join("") : url.pathname;
    if (!(path2 == null ? void 0 : path2.length)) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    const route = findRoute(router, request.method, path2);
    if (!(route == null ? void 0 : route.data)) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    const query = {};
    url.searchParams.forEach((value, key) => {
      if (key in query) {
        if (Array.isArray(query[key])) {
          query[key].push(value);
        } else {
          query[key] = [query[key], value];
        }
      } else {
        query[key] = value;
      }
    });
    const handler = route.data;
    const context = {
      path: path2,
      method: request.method,
      headers: request.headers,
      params: route.params ? JSON.parse(JSON.stringify(route.params)) : {},
      request,
      body: handler.options.disableBody ? void 0 : await getBody(handler.options.cloneRequest ? request.clone() : request),
      query,
      _flag: "router",
      asResponse: true,
      context: config2 == null ? void 0 : config2.routerContext
    };
    try {
      const middlewareRoutes = findAllRoutes(middlewareRouter, "*", path2);
      if (middlewareRoutes == null ? void 0 : middlewareRoutes.length) {
        for (const { data: middleware, params } of middlewareRoutes) {
          const res = await middleware({
            ...context,
            params,
            asResponse: false
          });
          if (res instanceof Response) return res;
        }
      }
      const response = await handler(context);
      return response;
    } catch (error) {
      if (config2 == null ? void 0 : config2.onError) {
        try {
          const errorResponse = await config2.onError(error);
          if (errorResponse instanceof Response) {
            return toResponse(errorResponse);
          }
        } catch (error2) {
          if (isAPIError(error2)) {
            return toResponse(error2);
          }
          throw error2;
        }
      }
      if (config2 == null ? void 0 : config2.throwError) {
        throw error;
      }
      if (isAPIError(error)) {
        return toResponse(error);
      }
      console.error(`# SERVER_ERROR: `, error);
      return new Response(null, {
        status: 500,
        statusText: "Internal Server Error"
      });
    }
  }, "processRequest");
  return {
    handler: /* @__PURE__ */ __name(async (request) => {
      var _a3, _b3;
      const onReq = await ((_a3 = config2 == null ? void 0 : config2.onRequest) == null ? void 0 : _a3.call(config2, request));
      if (onReq instanceof Response) {
        return onReq;
      }
      const req = onReq instanceof Request ? onReq : request;
      const res = await processRequest(req);
      const onRes = await ((_b3 = config2 == null ? void 0 : config2.onResponse) == null ? void 0 : _b3.call(config2, res));
      if (onRes instanceof Response) {
        return onRes;
      }
      return res;
    }, "handler"),
    endpoints
  };
}, "createRouter");
function createEndpoint(pathOrOptions, optionsOrHandler, maybeHandler) {
  let path2;
  let options;
  let handler;
  if (typeof pathOrOptions === "string") {
    path2 = pathOrOptions;
    options = optionsOrHandler;
    handler = maybeHandler;
  } else {
    path2 = "";
    options = pathOrOptions;
    handler = optionsOrHandler;
  }
  const endpoint = createEndpoint2(path2 || "/__farm_auto_path__", options, handler);
  endpoint.__path = path2 || void 0;
  endpoint.__method = options.method || "GET";
  endpoint.__autoPath = !path2;
  endpoint.__handler = handler;
  endpoint.__types = {
    body: options.body,
    query: options.query,
    response: null
  };
  return endpoint;
}
__name(createEndpoint, "createEndpoint");
var jsxRuntime = { exports: {} };
var reactJsxRuntime_production = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var hasRequiredReactJsxRuntime_production;
function requireReactJsxRuntime_production() {
  if (hasRequiredReactJsxRuntime_production) return reactJsxRuntime_production;
  hasRequiredReactJsxRuntime_production = 1;
  var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
  function jsxProd(type, config2, maybeKey) {
    var key = null;
    void 0 !== maybeKey && (key = "" + maybeKey);
    void 0 !== config2.key && (key = "" + config2.key);
    if ("key" in config2) {
      maybeKey = {};
      for (var propName in config2)
        "key" !== propName && (maybeKey[propName] = config2[propName]);
    } else maybeKey = config2;
    config2 = maybeKey.ref;
    return {
      $$typeof: REACT_ELEMENT_TYPE,
      type,
      key,
      ref: void 0 !== config2 ? config2 : null,
      props: maybeKey
    };
  }
  __name(jsxProd, "jsxProd");
  reactJsxRuntime_production.Fragment = REACT_FRAGMENT_TYPE;
  reactJsxRuntime_production.jsx = jsxProd;
  reactJsxRuntime_production.jsxs = jsxProd;
  return reactJsxRuntime_production;
}
__name(requireReactJsxRuntime_production, "requireReactJsxRuntime_production");
var reactJsxRuntime_development = {};
/**
 * @license React
 * react-jsx-runtime.development.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var hasRequiredReactJsxRuntime_development;
function requireReactJsxRuntime_development() {
  if (hasRequiredReactJsxRuntime_development) return reactJsxRuntime_development;
  hasRequiredReactJsxRuntime_development = 1;
  "production" !== process.env.NODE_ENV && function() {
    function getComponentNameFromType(type) {
      if (null == type) return null;
      if ("function" === typeof type)
        return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
      if ("string" === typeof type) return type;
      switch (type) {
        case REACT_FRAGMENT_TYPE:
          return "Fragment";
        case REACT_PROFILER_TYPE:
          return "Profiler";
        case REACT_STRICT_MODE_TYPE:
          return "StrictMode";
        case REACT_SUSPENSE_TYPE:
          return "Suspense";
        case REACT_SUSPENSE_LIST_TYPE:
          return "SuspenseList";
        case REACT_ACTIVITY_TYPE:
          return "Activity";
      }
      if ("object" === typeof type)
        switch ("number" === typeof type.tag && console.error(
          "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
        ), type.$$typeof) {
          case REACT_PORTAL_TYPE:
            return "Portal";
          case REACT_CONTEXT_TYPE:
            return type.displayName || "Context";
          case REACT_CONSUMER_TYPE:
            return (type._context.displayName || "Context") + ".Consumer";
          case REACT_FORWARD_REF_TYPE:
            var innerType = type.render;
            type = type.displayName;
            type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
            return type;
          case REACT_MEMO_TYPE:
            return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
          case REACT_LAZY_TYPE:
            innerType = type._payload;
            type = type._init;
            try {
              return getComponentNameFromType(type(innerType));
            } catch (x) {
            }
        }
      return null;
    }
    __name(getComponentNameFromType, "getComponentNameFromType");
    function testStringCoercion(value) {
      return "" + value;
    }
    __name(testStringCoercion, "testStringCoercion");
    function checkKeyStringCoercion(value) {
      try {
        testStringCoercion(value);
        var JSCompiler_inline_result = false;
      } catch (e) {
        JSCompiler_inline_result = true;
      }
      if (JSCompiler_inline_result) {
        JSCompiler_inline_result = console;
        var JSCompiler_temp_const = JSCompiler_inline_result.error;
        var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
        JSCompiler_temp_const.call(
          JSCompiler_inline_result,
          "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
          JSCompiler_inline_result$jscomp$0
        );
        return testStringCoercion(value);
      }
    }
    __name(checkKeyStringCoercion, "checkKeyStringCoercion");
    function getTaskName(type) {
      if (type === REACT_FRAGMENT_TYPE) return "<>";
      if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE)
        return "<...>";
      try {
        var name = getComponentNameFromType(type);
        return name ? "<" + name + ">" : "<...>";
      } catch (x) {
        return "<...>";
      }
    }
    __name(getTaskName, "getTaskName");
    function getOwner() {
      var dispatcher = ReactSharedInternals.A;
      return null === dispatcher ? null : dispatcher.getOwner();
    }
    __name(getOwner, "getOwner");
    function UnknownOwner() {
      return Error("react-stack-top-frame");
    }
    __name(UnknownOwner, "UnknownOwner");
    function hasValidKey(config2) {
      if (hasOwnProperty.call(config2, "key")) {
        var getter = Object.getOwnPropertyDescriptor(config2, "key").get;
        if (getter && getter.isReactWarning) return false;
      }
      return void 0 !== config2.key;
    }
    __name(hasValidKey, "hasValidKey");
    function defineKeyPropWarningGetter(props, displayName) {
      function warnAboutAccessingKey() {
        specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
          "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
          displayName
        ));
      }
      __name(warnAboutAccessingKey, "warnAboutAccessingKey");
      warnAboutAccessingKey.isReactWarning = true;
      Object.defineProperty(props, "key", {
        get: warnAboutAccessingKey,
        configurable: true
      });
    }
    __name(defineKeyPropWarningGetter, "defineKeyPropWarningGetter");
    function elementRefGetterWithDeprecationWarning() {
      var componentName = getComponentNameFromType(this.type);
      didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
        "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
      ));
      componentName = this.props.ref;
      return void 0 !== componentName ? componentName : null;
    }
    __name(elementRefGetterWithDeprecationWarning, "elementRefGetterWithDeprecationWarning");
    function ReactElement(type, key, props, owner, debugStack, debugTask) {
      var refProp = props.ref;
      type = {
        $$typeof: REACT_ELEMENT_TYPE,
        type,
        key,
        props,
        _owner: owner
      };
      null !== (void 0 !== refProp ? refProp : null) ? Object.defineProperty(type, "ref", {
        enumerable: false,
        get: elementRefGetterWithDeprecationWarning
      }) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
      type._store = {};
      Object.defineProperty(type._store, "validated", {
        configurable: false,
        enumerable: false,
        writable: true,
        value: 0
      });
      Object.defineProperty(type, "_debugInfo", {
        configurable: false,
        enumerable: false,
        writable: true,
        value: null
      });
      Object.defineProperty(type, "_debugStack", {
        configurable: false,
        enumerable: false,
        writable: true,
        value: debugStack
      });
      Object.defineProperty(type, "_debugTask", {
        configurable: false,
        enumerable: false,
        writable: true,
        value: debugTask
      });
      Object.freeze && (Object.freeze(type.props), Object.freeze(type));
      return type;
    }
    __name(ReactElement, "ReactElement");
    function jsxDEVImpl(type, config2, maybeKey, isStaticChildren, debugStack, debugTask) {
      var children = config2.children;
      if (void 0 !== children)
        if (isStaticChildren)
          if (isArrayImpl(children)) {
            for (isStaticChildren = 0; isStaticChildren < children.length; isStaticChildren++)
              validateChildKeys(children[isStaticChildren]);
            Object.freeze && Object.freeze(children);
          } else
            console.error(
              "React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead."
            );
        else validateChildKeys(children);
      if (hasOwnProperty.call(config2, "key")) {
        children = getComponentNameFromType(type);
        var keys = Object.keys(config2).filter(function(k) {
          return "key" !== k;
        });
        isStaticChildren = 0 < keys.length ? "{key: someKey, " + keys.join(": ..., ") + ": ...}" : "{key: someKey}";
        didWarnAboutKeySpread[children + isStaticChildren] || (keys = 0 < keys.length ? "{" + keys.join(": ..., ") + ": ...}" : "{}", console.error(
          'A props object containing a "key" prop is being spread into JSX:\n  let props = %s;\n  <%s {...props} />\nReact keys must be passed directly to JSX without using spread:\n  let props = %s;\n  <%s key={someKey} {...props} />',
          isStaticChildren,
          children,
          keys,
          children
        ), didWarnAboutKeySpread[children + isStaticChildren] = true);
      }
      children = null;
      void 0 !== maybeKey && (checkKeyStringCoercion(maybeKey), children = "" + maybeKey);
      hasValidKey(config2) && (checkKeyStringCoercion(config2.key), children = "" + config2.key);
      if ("key" in config2) {
        maybeKey = {};
        for (var propName in config2)
          "key" !== propName && (maybeKey[propName] = config2[propName]);
      } else maybeKey = config2;
      children && defineKeyPropWarningGetter(
        maybeKey,
        "function" === typeof type ? type.displayName || type.name || "Unknown" : type
      );
      return ReactElement(
        type,
        children,
        maybeKey,
        getOwner(),
        debugStack,
        debugTask
      );
    }
    __name(jsxDEVImpl, "jsxDEVImpl");
    function validateChildKeys(node) {
      isValidElement(node) ? node._store && (node._store.validated = 1) : "object" === typeof node && null !== node && node.$$typeof === REACT_LAZY_TYPE && ("fulfilled" === node._payload.status ? isValidElement(node._payload.value) && node._payload.value._store && (node._payload.value._store.validated = 1) : node._store && (node._store.validated = 1));
    }
    __name(validateChildKeys, "validateChildKeys");
    function isValidElement(object) {
      return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
    }
    __name(isValidElement, "isValidElement");
    var React2 = reactExports, REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = Symbol.for("react.profiler"), REACT_CONSUMER_TYPE = Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = Symbol.for("react.memo"), REACT_LAZY_TYPE = Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = Symbol.for("react.activity"), REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"), ReactSharedInternals = React2.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, hasOwnProperty = Object.prototype.hasOwnProperty, isArrayImpl = Array.isArray, createTask = console.createTask ? console.createTask : function() {
      return null;
    };
    React2 = {
      react_stack_bottom_frame: /* @__PURE__ */ __name(function(callStackForError) {
        return callStackForError();
      }, "react_stack_bottom_frame")
    };
    var specialPropKeyWarningShown;
    var didWarnAboutElementRef = {};
    var unknownOwnerDebugStack = React2.react_stack_bottom_frame.bind(
      React2,
      UnknownOwner
    )();
    var unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
    var didWarnAboutKeySpread = {};
    reactJsxRuntime_development.Fragment = REACT_FRAGMENT_TYPE;
    reactJsxRuntime_development.jsx = function(type, config2, maybeKey) {
      var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
      return jsxDEVImpl(
        type,
        config2,
        maybeKey,
        false,
        trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
        trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
      );
    };
    reactJsxRuntime_development.jsxs = function(type, config2, maybeKey) {
      var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
      return jsxDEVImpl(
        type,
        config2,
        maybeKey,
        true,
        trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
        trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
      );
    };
  }();
  return reactJsxRuntime_development;
}
__name(requireReactJsxRuntime_development, "requireReactJsxRuntime_development");
if (process.env.NODE_ENV === "production") {
  jsxRuntime.exports = requireReactJsxRuntime_production();
} else {
  jsxRuntime.exports = requireReactJsxRuntime_development();
}
var jsxRuntimeExports = jsxRuntime.exports;
reactExports.createContext(null);
const _filename = typeof import.meta.url !== "undefined" ? fileURLToPath(import.meta.url) : "";
path.dirname(_filename);
new AsyncLocalStorage();
const GET$1 = createEndpoint("/api/hello", {
  method: "GET",
  query: z.object({
    name: z.string().optional()
  })
}, async (ctx) => {
  const name = ctx.query.name || "World";
  console.log(`[API] GET /api/hello - name: ${name}`);
  return {
    message: `Hello, ${name}!`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    method: "GET"
  };
});
const POST$1 = createEndpoint("/api/hello", {
  method: "POST",
  body: z.object({
    name: z.string(),
    email: z.string().email().optional()
  })
}, async (ctx) => {
  const { name, email } = ctx.body;
  console.log(`[API] POST /api/hello - name: ${name}, email: ${email}`);
  return {
    message: `Hello, ${name}!`,
    email: email || "not provided",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    method: "POST"
  };
});
const apiRoute0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GET: GET$1,
  POST: POST$1
}, Symbol.toStringTag, { value: "Module" }));
const users = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "admin" },
  { id: 2, name: "Bob Smith", email: "bob@example.com", role: "user" },
  { id: 3, name: "Charlie Brown", email: "charlie@example.com", role: "user" }
];
const GET = createEndpoint("/api/users", {
  method: "GET",
  query: z.object({
    role: z.enum(["admin", "user"]).optional(),
    limit: z.coerce.number().min(1).max(100).optional()
  })
}, async (ctx) => {
  console.log(`[API] GET /api/users - role: ${ctx.query.role}, limit: ${ctx.query.limit}`);
  let result = [...users];
  if (ctx.query.role) {
    result = result.filter((u) => u.role === ctx.query.role);
  }
  if (ctx.query.limit) {
    result = result.slice(0, ctx.query.limit);
  }
  return {
    users: result,
    total: result.length,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
});
const POST = createEndpoint("/api/users", {
  method: "POST",
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(["admin", "user"]).default("user")
  })
}, async (ctx) => {
  console.log(`[API] POST /api/users - creating user:`, ctx.body);
  const newUser = {
    id: users.length + 1,
    ...ctx.body
  };
  users.push(newUser);
  return {
    success: true,
    user: newUser,
    message: `User ${ctx.body.name} created successfully`
  };
});
const apiRoute1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  GET,
  POST
}, Symbol.toStringTag, { value: "Module" }));
async function getCurrentTime() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(getCurrentTime, "getCurrentTime");
const metadata$4 = {
  title: "Home - SSR Demo",
  description: "This page is server-rendered on each request"
};
async function HomePage({ params, searchParams }) {
  const currentTime = await getCurrentTime();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium", children: "SSR" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-gray-500", children: "Server-Side Rendering" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-4", children: "Welcome to Farm.js" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gray-600 mb-6", children: [
        "This page is rendered on the server for ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "every request" }),
        ". The time below updates on each page load."
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-gray-100 rounded-lg p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-gray-500 mb-1", children: "Server Time:" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-2xl font-mono text-gray-900", children: currentTime })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-3", children: "SSR Pages" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600 mb-4", children: "No special exports needed. SSR is the default behavior." }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-3 text-sm overflow-x-auto", children: `// No special exports = SSR
export default function Page() {
  return <div>Hello</div>;
}` })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-3", children: "SSG Pages" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gray-600 mb-4", children: [
          "Add ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "bg-gray-100 px-1 rounded", children: "export const ssg = true" }),
          " to pre-render."
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-3 text-sm overflow-x-auto", children: `// SSG = pre-render at build time
export const ssg = true;

export default function Page() {
  return <div>Static</div>;
}` })
      ] })
    ] })
  ] });
}
__name(HomePage, "HomePage");
const pageRoute0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: HomePage,
  metadata: metadata$4
}, Symbol.toStringTag, { value: "Module" }));
const ssg$3 = true;
const metadata$3 = {
  title: "About - SSG Demo",
  description: "This page is pre-rendered at build time"
};
function AboutPage() {
  const buildTime = (/* @__PURE__ */ new Date()).toISOString();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium", children: "SSG" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-gray-500", children: "Static Site Generation" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-4", children: "About Us" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gray-600 mb-6", children: [
        "This page was ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "pre-rendered at build time" }),
        ". The time below was captured during the build, not when you loaded the page."
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-gray-100 rounded-lg p-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-sm text-gray-500 mb-1", children: "Build Time (Static):" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-2xl font-mono text-gray-900", children: buildTime })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "How it works" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center font-bold", children: "1" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "font-semibold text-gray-900", children: "Build Time" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gray-600", children: [
              "Farm.js detects ",
              /* @__PURE__ */ jsxRuntimeExports.jsx("code", { className: "bg-gray-100 px-1 rounded", children: "export const ssg = true" }),
              "and renders this page during the build."
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center font-bold", children: "2" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "font-semibold text-gray-900", children: "HTML Generated" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600", children: "The rendered HTML is saved as a static file in the build output." })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-8 h-8 rounded-full bg-green-100 text-green-800 flex items-center justify-center font-bold", children: "3" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "font-semibold text-gray-900", children: "Instant Delivery" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600", children: "When users request this page, the pre-built HTML is served instantly - no server rendering needed!" })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Code Example" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: `// src/app/about/page.tsx

// ✅ This is all you need for SSG!
export const ssg = true;

export const metadata = {
  title: "About Us",
};

export default function AboutPage() {
  return (
    <div>
      <h1>About Us</h1>
      <p>This content is static.</p>
    </div>
  );
}` })
    ] })
  ] });
}
__name(AboutPage, "AboutPage");
const pageRoute1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: AboutPage,
  metadata: metadata$3,
  ssg: ssg$3
}, Symbol.toStringTag, { value: "Module" }));
function DashboardPage() {
  const [count, setCount] = reactExports.useState(0);
  const [lastUpdated, setLastUpdated] = reactExports.useState("");
  reactExports.useEffect(() => {
    setLastUpdated((/* @__PURE__ */ new Date()).toISOString());
  }, []);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium", children: "SSR" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium", children: "Client Interactive" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-4", children: "Dashboard" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gray-600 mb-4", children: [
        "This page demonstrates ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "SSR with client-side interactivity" }),
        ". The page is server-rendered, then hydrated on the client for interactivity."
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bg-gray-100 rounded-lg p-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-gray-500", children: [
        "Client-side time: ",
        lastUpdated
      ] }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-sm text-gray-500 mb-2", children: "Total Users" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-3xl font-bold text-gray-900", children: "1,234" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-green-600 text-sm", children: "+12% from last week" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-sm text-gray-500 mb-2", children: "Page Views" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-3xl font-bold text-gray-900", children: "45.2K" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-green-600 text-sm", children: "+8% from last week" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-sm text-gray-500 mb-2", children: "Conversion Rate" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-3xl font-bold text-gray-900", children: "3.2%" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-red-600 text-sm", children: "-0.5% from last week" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Interactive Counter (Client-Side)" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600 mb-4", children: "This counter demonstrates client-side interactivity after hydration." }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            onClick: /* @__PURE__ */ __name(() => setCount((c) => c - 1), "onClick"),
            className: "px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-bold",
            children: "-"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-4xl font-bold text-gray-900 w-20 text-center", children: count }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            onClick: /* @__PURE__ */ __name(() => setCount((c) => c + 1), "onClick"),
            className: "px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold",
            children: "+"
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Code Example" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: `"use client";

// No ssg export = SSR (default)
// "use client" enables interactivity

import { useState } from "react";

export default function DashboardPage() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>
        Increment
      </button>
    </div>
  );
}` })
    ] })
  ] });
}
__name(DashboardPage, "DashboardPage");
const pageRoute2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: DashboardPage
}, Symbol.toStringTag, { value: "Module" }));
const metadata$2 = {
  title: "API Demo - Farm.js",
  description: "Demonstrating API routes with typed endpoints"
};
function ApiDemoPage() {
  const [helloResult, setHelloResult] = reactExports.useState(null);
  const [usersResult, setUsersResult] = reactExports.useState(null);
  const [postResult, setPostResult] = reactExports.useState(null);
  const [loading, setLoading] = reactExports.useState(null);
  const fetchHello = /* @__PURE__ */ __name(async (name) => {
    setLoading("hello");
    try {
      const url = name ? `/api/hello?name=${encodeURIComponent(name)}` : "/api/hello";
      const res = await fetch(url);
      const data = await res.json();
      setHelloResult(data);
    } catch (error) {
      setHelloResult({ error: String(error) });
    }
    setLoading(null);
  }, "fetchHello");
  const fetchUsers = /* @__PURE__ */ __name(async (role) => {
    setLoading("users");
    try {
      const url = role ? `/api/users?role=${role}` : "/api/users";
      const res = await fetch(url);
      const data = await res.json();
      setUsersResult(data);
    } catch (error) {
      setUsersResult({ error: String(error) });
    }
    setLoading(null);
  }, "fetchUsers");
  const createUser = /* @__PURE__ */ __name(async () => {
    setLoading("post");
    try {
      const res = await fetch("/api/hello", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New User", email: "new@example.com" })
      });
      const data = await res.json();
      setPostResult(data);
    } catch (error) {
      setPostResult({ error: String(error) });
    }
    setLoading(null);
  }, "createUser");
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium", children: "API Routes" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-gray-500", children: "Type-safe endpoints" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-4", children: "API Demo" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600 mb-6", children: "Farm.js provides type-safe API routes with Zod validation. Click the buttons below to test the endpoints." })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "GET /api/hello" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-4 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            onClick: /* @__PURE__ */ __name(() => fetchHello(), "onClick"),
            disabled: loading === "hello",
            className: "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50",
            children: loading === "hello" ? "Loading..." : "Call without name"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            onClick: /* @__PURE__ */ __name(() => fetchHello("Farm.js User"), "onClick"),
            disabled: loading === "hello",
            className: "px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50",
            children: loading === "hello" ? "Loading..." : "Call with name"
          }
        )
      ] }),
      helloResult && /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: JSON.stringify(helloResult, null, 2) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "GET /api/users" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-4 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            onClick: /* @__PURE__ */ __name(() => fetchUsers(), "onClick"),
            disabled: loading === "users",
            className: "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50",
            children: loading === "users" ? "Loading..." : "Get all users"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            onClick: /* @__PURE__ */ __name(() => fetchUsers("admin"), "onClick"),
            disabled: loading === "users",
            className: "px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50",
            children: loading === "users" ? "Loading..." : "Get admins only"
          }
        )
      ] }),
      usersResult && /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: JSON.stringify(usersResult, null, 2) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "POST /api/hello" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          onClick: createUser,
          disabled: loading === "post",
          className: "px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 mb-4",
          children: loading === "post" ? "Loading..." : "Send POST request"
        }
      ),
      postResult && /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: JSON.stringify(postResult, null, 2) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "API Route Code" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: `// src/app/api/hello/route.ts
import { createEndpoint } from "@farmjs/core/api";
import { z } from "zod";

export const GET = createEndpoint({
  query: z.object({
    name: z.string().optional(),
  }),
  handler: async ({ query }) => {
    return {
      message: \`Hello, \${query.name || "World"}!\`,
      timestamp: new Date().toISOString(),
    };
  },
});` })
    ] })
  ] });
}
__name(ApiDemoPage, "ApiDemoPage");
const pageRoute3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ApiDemoPage,
  metadata: metadata$2
}, Symbol.toStringTag, { value: "Module" }));
const ssg$2 = true;
const revalidate = 60;
const metadata$1 = {
  title: "Products - ISR Demo",
  description: "Static page that regenerates every 60 seconds"
};
async function getProducts() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return [
    { id: 1, name: "Farm.js Pro", price: "$99", description: "Full framework license", emoji: "🚀" },
    { id: 2, name: "Cloud Hosting", price: "$29/mo", description: "Managed deployment", emoji: "☁️" },
    { id: 3, name: "Support Package", price: "$199/mo", description: "Priority support", emoji: "💬" },
    { id: 4, name: "Enterprise", price: "Contact", description: "Custom solutions", emoji: "🏢" }
  ];
}
__name(getProducts, "getProducts");
async function ProductsPage() {
  const products = await getProducts();
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium", children: "SSG" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-medium", children: "ISR: 60s" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-4", children: "Products" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gray-600 mb-4", children: [
        "This page uses ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "Incremental Static Regeneration (ISR)" }),
        ". It's pre-rendered at build time but regenerates every 60 seconds."
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bg-gray-100 rounded-lg p-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-gray-500", children: [
        "Page generated: ",
        generatedAt,
        /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-orange-600", children: "Will regenerate after 60 seconds of staleness" })
      ] }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: products.map((product) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start justify-between mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-3xl", children: product.emoji }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-xl font-bold text-green-600", children: product.price })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-2", children: product.name }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600", children: product.description })
    ] }, product.id)) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "How ISR Works" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-8 h-8 rounded-full bg-orange-100 text-orange-800 flex items-center justify-center font-bold", children: "1" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "font-semibold text-gray-900", children: "Initial Build" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600", children: "Page is pre-rendered at build time like regular SSG." })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-8 h-8 rounded-full bg-orange-100 text-orange-800 flex items-center justify-center font-bold", children: "2" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "font-semibold text-gray-900", children: "Serve Static" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600", children: "Users receive the static HTML instantly." })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-start gap-4", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "w-8 h-8 rounded-full bg-orange-100 text-orange-800 flex items-center justify-center font-bold", children: "3" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "font-semibold text-gray-900", children: "Background Regeneration" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600", children: "After 60 seconds, the next request triggers a background regeneration. Users still get the cached version while the new one builds." })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Code Example" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: `// SSG with ISR - regenerate every 60 seconds
export const ssg = true;
export const revalidate = 60;

async function getProducts() {
  const res = await fetch('https://api.example.com/products');
  return res.json();
}

export default async function ProductsPage() {
  const products = await getProducts();
  
  return (
    <div>
      {products.map(p => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}` })
    ] })
  ] });
}
__name(ProductsPage, "ProductsPage");
const pageRoute4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ProductsPage,
  metadata: metadata$1,
  revalidate,
  ssg: ssg$2
}, Symbol.toStringTag, { value: "Module" }));
const ssg$1 = true;
const metadata = {
  title: "Team - SSG with Data",
  description: "Static page with data fetched at build time"
};
async function getTeamMembers() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  return [
    { id: 1, name: "Alice Johnson", role: "CEO", avatar: "👩‍💼" },
    { id: 2, name: "Bob Smith", role: "CTO", avatar: "👨‍💻" },
    { id: 3, name: "Carol Williams", role: "Design Lead", avatar: "👩‍🎨" },
    { id: 4, name: "David Brown", role: "Engineering Lead", avatar: "👨‍🔬" }
  ];
}
__name(getTeamMembers, "getTeamMembers");
async function TeamPage() {
  const team = await getTeamMembers();
  const buildTime = (/* @__PURE__ */ new Date()).toISOString();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium", children: "SSG" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium", children: "Async Data" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-4", children: "Our Team" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-gray-600 mb-4", children: [
        "This page fetches team data ",
        /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "at build time" }),
        ". The data is embedded in the static HTML."
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bg-gray-100 rounded-lg p-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-gray-500", children: [
        "Data fetched at: ",
        buildTime
      ] }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: team.map((member) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bg-white rounded-lg shadow-md p-6", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-4", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "text-4xl", children: member.avatar }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900", children: member.name }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-600", children: member.role })
      ] })
    ] }) }, member.id)) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Code Example" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: `// SSG with async data fetching
export const ssg = true;

async function getTeamMembers() {
  const res = await fetch('https://api.example.com/team');
  return res.json();
}

// Async component - data fetched at build time
export default async function TeamPage() {
  const team = await getTeamMembers();
  
  return (
    <ul>
      {team.map(m => <li key={m.id}>{m.name}</li>)}
    </ul>
  );
}` })
    ] })
  ] });
}
__name(TeamPage, "TeamPage");
const pageRoute5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: TeamPage,
  metadata,
  ssg: ssg$1
}, Symbol.toStringTag, { value: "Module" }));
const ssg = true;
async function getStaticPaths() {
  const posts = [
    { slug: "hello-world" },
    { slug: "getting-started" },
    { slug: "advanced-usage" }
  ];
  return posts;
}
__name(getStaticPaths, "getStaticPaths");
const blogPosts = {
  "hello-world": {
    title: "Hello World - Getting Started with Farm.js",
    content: `
      Welcome to Farm.js! This is your first step into a powerful React meta-framework.
      
      Farm.js provides:
      - File-based routing
      - Server-Side Rendering (SSR) by default
      - Static Site Generation (SSG) opt-in
      - API routes
      - Middleware support
      - And much more!
    `,
    date: "2024-01-15",
    author: "Farm.js Team"
  },
  "getting-started": {
    title: "Getting Started with Farm.js",
    content: `
      To get started with Farm.js, follow these simple steps:
      
      1. Create a new project
      2. Configure your routes
      3. Start building!
      
      Farm.js uses file-based routing, so creating pages is as simple as adding files.
    `,
    date: "2024-01-16",
    author: "Alice Developer"
  },
  "advanced-usage": {
    title: "Advanced Farm.js Patterns",
    content: `
      Once you're comfortable with the basics, explore advanced patterns:
      
      - Custom middleware
      - API route handlers
      - SSG with ISR
      - Dynamic imports
      - Server components
    `,
    date: "2024-01-17",
    author: "Bob Engineer"
  }
};
function BlogPostPage({ params }) {
  const slug = params.slug;
  const post = blogPosts[slug] || {
    title: "Post Not Found",
    content: "This post does not exist.",
    date: "Unknown",
    author: "Unknown"
  };
  const buildTime = (/* @__PURE__ */ new Date()).toISOString();
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-8", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-2 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium", children: "SSG" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm font-medium", children: "Dynamic Route" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("nav", { className: "text-sm text-gray-500 mb-4", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("a", { href: "/blog", className: "hover:text-green-600", children: "Blog" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "mx-2", children: "/" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: slug })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-4", children: post.title }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex items-center gap-4 text-sm text-gray-500 mb-6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
          "By ",
          post.author
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "•" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: post.date })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "prose max-w-none", children: /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-gray-700 whitespace-pre-line", children: post.content }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-6 bg-gray-100 rounded-lg p-4", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "text-sm text-gray-500", children: [
        "Pre-rendered at build time: ",
        buildTime
      ] }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Other Posts" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "space-y-2", children: Object.entries(blogPosts).map(([postSlug, postData]) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "a",
        {
          href: `/blog/${postSlug}`,
          className: `block p-3 rounded-lg hover:bg-gray-50 ${postSlug === slug ? "bg-green-50" : ""}`,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium text-gray-900", children: postData.title }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "text-gray-500 text-sm ml-2", children: postData.date })
          ]
        },
        postSlug
      )) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bg-white rounded-lg shadow-md p-6", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Code Example" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "bg-gray-100 rounded p-4 text-sm overflow-x-auto", children: `// src/app/blog/[slug]/page.tsx

export const ssg = true;

// Define all paths to pre-render
export async function getStaticPaths() {
  const posts = await fetch('https://api.example.com/posts')
    .then(r => r.json());
  
  return posts.map(post => ({ slug: post.slug }));
}

export default async function BlogPost({ params }) {
  const post = await fetch(\`https://api.example.com/posts/\${params.slug}\`)
    .then(r => r.json());
  
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}` })
    ] })
  ] });
}
__name(BlogPostPage, "BlogPostPage");
const pageRoute6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: BlogPostPage,
  getStaticPaths,
  ssg
}, Symbol.toStringTag, { value: "Module" }));
const apiRoutes = [
  {
    path: "/api/hello",
    methods: ["GET", "POST"],
    handlers: apiRoute0
  },
  {
    path: "/api/users",
    methods: ["GET", "POST"],
    handlers: apiRoute1
  }
];
const pageRoutes = [
  {
    pattern: "/",
    module: pageRoute0
  },
  {
    pattern: "/about",
    module: pageRoute1
  },
  {
    pattern: "/dashboard",
    module: pageRoute2
  },
  {
    pattern: "/api-demo",
    module: pageRoute3
  },
  {
    pattern: "/products",
    module: pageRoute4
  },
  {
    pattern: "/team",
    module: pageRoute5
  },
  {
    pattern: "/blog/[slug]",
    module: pageRoute6
  }
];
function createAPIHandler() {
  const allEndpoints = {};
  for (const route of apiRoutes) {
    for (const method of route.methods) {
      const handler = route.handlers[method];
      if (handler) {
        if (!handler.__path) {
          handler.__path = route.path;
        }
        const key = `${method.toLowerCase()}_${route.path.replace(/\//g, "_").replace(/-/g, "_")}`;
        allEndpoints[key] = handler;
      }
    }
  }
  if (Object.keys(allEndpoints).length > 0) {
    const router = createRouter(allEndpoints, { basePath: "" });
    return router.handler;
  }
  return null;
}
__name(createAPIHandler, "createAPIHandler");
const apiHandler = createAPIHandler();
function matchPageRoute(pathname) {
  for (const route of pageRoutes) {
    const regexPattern = route.pattern.replace(/\[([^\]]+)\]/g, "(?<$1>[^/]+)").replace(/\/:([^/]+)/g, "/(?<$1>[^/]+)").replace(/\//g, "\\/");
    const regex = new RegExp(`^${regexPattern}$`);
    const match = pathname.match(regex);
    if (match) {
      const params = match.groups || {};
      return { route, params };
    }
  }
  return null;
}
__name(matchPageRoute, "matchPageRoute");
async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) {
    if (apiHandler) {
      try {
        return await apiHandler(request);
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message || "Internal Server Error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    return new Response(
      JSON.stringify({ error: "API route not found", pathname }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }
  const matchedRoute = matchPageRoute(pathname);
  if (matchedRoute) {
    const { route, params } = matchedRoute;
    try {
      const PageComponent = route.module.default;
      const metadata2 = route.module.metadata || {};
      if (PageComponent) {
        const searchParamsObj = Object.fromEntries(url.searchParams.entries());
        const ReactDOMServer = await import("./assets/server.node-pKixXoe3.js").then((n) => n.s);
        const React2 = await Promise.resolve().then(() => index);
        const searchParams = Promise.resolve(searchParamsObj);
        const pageProps = { params, searchParams };
        let html = "";
        if (PageComponent.constructor.name === "AsyncFunction" || PageComponent.toString().includes("async")) {
          try {
            const result = await PageComponent(pageProps);
            if (React2.isValidElement(result)) {
              html = ReactDOMServer.renderToString(result);
            } else {
              html = ReactDOMServer.renderToString(React2.createElement("div", null, String(result)));
            }
          } catch (asyncError) {
            const element = React2.createElement(PageComponent, pageProps);
            html = ReactDOMServer.renderToString(element);
          }
        } else {
          const element = React2.createElement(PageComponent, pageProps);
          html = ReactDOMServer.renderToString(element);
        }
        const title = metadata2.title || "Farm.js App";
        const description = metadata2.description || "";
        let metaTags = "";
        if (description) {
          metaTags += `
  <meta name="description" content="${description.replace(/"/g, "&quot;")}">`;
        }
        if (metadata2.keywords) {
          const keywords = Array.isArray(metadata2.keywords) ? metadata2.keywords.join(", ") : metadata2.keywords;
          metaTags += `
  <meta name="keywords" content="${keywords.replace(/"/g, "&quot;")}">`;
        }
        if (metadata2.openGraph) {
          const og = metadata2.openGraph;
          if (og.title) metaTags += `
  <meta property="og:title" content="${og.title.replace(/"/g, "&quot;")}">`;
          if (og.description) metaTags += `
  <meta property="og:description" content="${og.description.replace(/"/g, "&quot;")}">`;
          if (og.image) metaTags += `
  <meta property="og:image" content="${og.image}">`;
        }
        return new Response(
          `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>${metaTags}
  <link rel="stylesheet" href="/farm-client.css">
</head>
<body>
  <div id="root">${html}</div>
  <script type="module" src="/farm-client.js"><\/script>
</body>
</html>`,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
            }
          }
        );
      }
    } catch (error) {
      console.error("SSR Error:", error);
      return new Response(
        `<html><body><h1>Error</h1><p>${error.message}</p><pre>${error.stack}</pre></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
    }
  }
  return new Response(
    JSON.stringify({
      error: "Not Found",
      pathname,
      availableRoutes: pageRoutes.map((r) => r.pattern),
      availableAPIRoutes: apiRoutes.map((r) => r.path)
    }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}
__name(handleRequest, "handleRequest");
const fetch$1 = handleRequest;
const _virtual_farmSsrEntry = { fetch: fetch$1 };
export {
  _virtual_farmSsrEntry as default,
  fetch$1 as fetch,
  reactExports as r
};
