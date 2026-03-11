var __defProp = Object.defineProperty;
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var _a, _b, _c, _d, _e2, _f, _g, _h, _r2, _t2, _e3, _i, _j, _k, _l;
import * as ce from "module";
import ce__default from "module";
import { pathToFileURL } from "url";
import { c as commonjsGlobal, g as getDefaultExportFromCjs } from "../_virtual_farm-ssr-entry.js";
import require$$0 from "process";
import require$$0$1 from "constants";
import require$$0$2 from "stream";
import require$$0$3 from "util";
import fs5__default from "fs";
import require$$5 from "assert";
import * as path9 from "path";
import path9__default from "path";
import require$$1, { createRequire } from "node:module";
import require$$9 from "node:crypto";
import require$$10 from "node:tty";
import require$$12 from "node:vm";
import require$$0$4 from "node:os";
import require$$4 from "node:assert";
import require$$8 from "node:util";
import require$$7 from "node:v8";
import require$$2 from "node:fs";
import require$$3 from "node:url";
import require$$11 from "node:perf_hooks";
import require$$6 from "node:path";
import require$$5$1 from "node:process";
import de from "fs/promises";
import { compile, Features as Features$1 } from "tailwindcss";
import { transform, Features } from "lightningcss";
import * as D$1 from "vite";
import "async_hooks";
import "crypto";
import "zod";
import "nitro";
const memoize$1 = /* @__PURE__ */ __name((fn) => {
  let cache = false;
  let result;
  return () => {
    if (cache) {
      return (
        /** @type {T} */
        result
      );
    }
    result = fn();
    cache = true;
    fn = void 0;
    return (
      /** @type {T} */
      result
    );
  };
}, "memoize$1");
var memoize_1 = memoize$1;
var CachedInputFileSystem_1;
var hasRequiredCachedInputFileSystem;
function requireCachedInputFileSystem() {
  var _a2;
  if (hasRequiredCachedInputFileSystem) return CachedInputFileSystem_1;
  hasRequiredCachedInputFileSystem = 1;
  const { nextTick } = require$$0;
  const dirname = /* @__PURE__ */ __name((path2) => {
    let idx = path2.length - 1;
    while (idx >= 0) {
      const char = path2.charCodeAt(idx);
      if (char === 47 || char === 92) break;
      idx--;
    }
    if (idx < 0) return "";
    return path2.slice(0, idx);
  }, "dirname");
  const runCallbacks = /* @__PURE__ */ __name((callbacks, err, result) => {
    if (callbacks.length === 1) {
      callbacks[0](err, result);
      callbacks.length = 0;
      return;
    }
    let error;
    for (const callback of callbacks) {
      try {
        callback(err, result);
      } catch (err2) {
        if (!error) error = err2;
      }
    }
    callbacks.length = 0;
    if (error) throw error;
  }, "runCallbacks");
  const _OperationMergerBackend = class _OperationMergerBackend {
    /**
     * @param {EXPECTED_FUNCTION | undefined} provider async method in filesystem
     * @param {EXPECTED_FUNCTION | undefined} syncProvider sync method in filesystem
     * @param {BaseFileSystem} providerContext call context for the provider methods
     */
    constructor(provider, syncProvider, providerContext) {
      this._provider = provider;
      this._syncProvider = syncProvider;
      this._providerContext = providerContext;
      this._activeAsyncOperations = /* @__PURE__ */ new Map();
      this.provide = this._provider ? (
        // Comment to align jsdoc
        /**
         * @param {PathLike | PathOrFileDescriptor} path path
         * @param {object | FileSystemCallback<EXPECTED_ANY> | undefined} options options
         * @param {FileSystemCallback<EXPECTED_ANY>=} callback callback
         * @returns {EXPECTED_ANY} result
         */
        (path2, options, callback) => {
          if (typeof options === "function") {
            callback = /** @type {FileSystemCallback<EXPECTED_ANY>} */
            options;
            options = void 0;
          }
          if (typeof path2 !== "string" && !Buffer.isBuffer(path2) && !(path2 instanceof URL) && typeof path2 !== "number") {
            callback(
              new TypeError("path must be a string, Buffer, URL or number")
            );
            return;
          }
          if (options) {
            return (
              /** @type {EXPECTED_FUNCTION} */
              this._provider.call(
                this._providerContext,
                path2,
                options,
                callback
              )
            );
          }
          let callbacks = this._activeAsyncOperations.get(path2);
          if (callbacks) {
            callbacks.push(callback);
            return;
          }
          this._activeAsyncOperations.set(path2, callbacks = [callback]);
          provider(
            path2,
            /**
             * @param {Error} err error
             * @param {EXPECTED_ANY} result result
             */
            (err, result) => {
              this._activeAsyncOperations.delete(path2);
              runCallbacks(callbacks, err, result);
            }
          );
        }
      ) : null;
      this.provideSync = this._syncProvider ? (
        // Comment to align jsdoc
        /**
         * @param {PathLike | PathOrFileDescriptor} path path
         * @param {object=} options options
         * @returns {EXPECTED_ANY} result
         */
        (path2, options) => (
          /** @type {EXPECTED_FUNCTION} */
          this._syncProvider.call(
            this._providerContext,
            path2,
            options
          )
        )
      ) : null;
    }
    purge() {
    }
    purgeParent() {
    }
  };
  __name(_OperationMergerBackend, "OperationMergerBackend");
  let OperationMergerBackend = _OperationMergerBackend;
  const STORAGE_MODE_IDLE = 0;
  const STORAGE_MODE_SYNC = 1;
  const STORAGE_MODE_ASYNC = 2;
  const _CacheBackend = class _CacheBackend {
    /**
     * @param {number} duration max cache duration of items
     * @param {EXPECTED_FUNCTION | undefined} provider async method
     * @param {EXPECTED_FUNCTION | undefined} syncProvider sync method
     * @param {BaseFileSystem} providerContext call context for the provider methods
     */
    constructor(duration, provider, syncProvider, providerContext) {
      this._duration = duration;
      this._provider = provider;
      this._syncProvider = syncProvider;
      this._providerContext = providerContext;
      this._activeAsyncOperations = /* @__PURE__ */ new Map();
      this._data = /* @__PURE__ */ new Map();
      this._levels = [];
      for (let i2 = 0; i2 < 10; i2++) this._levels.push(/* @__PURE__ */ new Set());
      for (let i2 = 5e3; i2 < duration; i2 += 500) this._levels.push(/* @__PURE__ */ new Set());
      this._currentLevel = 0;
      this._tickInterval = Math.floor(duration / this._levels.length);
      this._mode = STORAGE_MODE_IDLE;
      this._timeout = void 0;
      this._nextDecay = void 0;
      this.provide = provider ? this.provide.bind(this) : null;
      this.provideSync = syncProvider ? this.provideSync.bind(this) : null;
    }
    /**
     * @param {PathLike | PathOrFileDescriptor} path path
     * @param {EXPECTED_ANY} options options
     * @param {FileSystemCallback<EXPECTED_ANY>} callback callback
     * @returns {void}
     */
    provide(path2, options, callback) {
      if (typeof options === "function") {
        callback = options;
        options = void 0;
      }
      if (typeof path2 !== "string" && !Buffer.isBuffer(path2) && !(path2 instanceof URL) && typeof path2 !== "number") {
        callback(new TypeError("path must be a string, Buffer, URL or number"));
        return;
      }
      const strPath = typeof path2 !== "string" ? path2.toString() : path2;
      if (options) {
        return (
          /** @type {EXPECTED_FUNCTION} */
          this._provider.call(
            this._providerContext,
            path2,
            options,
            callback
          )
        );
      }
      if (this._mode === STORAGE_MODE_SYNC) {
        this._enterAsyncMode();
      }
      const cacheEntry = this._data.get(strPath);
      if (cacheEntry !== void 0) {
        if (cacheEntry.err) return nextTick(callback, cacheEntry.err);
        return nextTick(callback, null, cacheEntry.result);
      }
      let callbacks = this._activeAsyncOperations.get(strPath);
      if (callbacks !== void 0) {
        callbacks.push(callback);
        return;
      }
      this._activeAsyncOperations.set(strPath, callbacks = [callback]);
      this._provider.call(
        this._providerContext,
        path2,
        /**
         * @param {Error | null} err error
         * @param {EXPECTED_ANY=} result result
         */
        (err, result) => {
          this._activeAsyncOperations.delete(strPath);
          this._storeResult(strPath, err, result);
          this._enterAsyncMode();
          runCallbacks(
            /** @type {FileSystemCallback<EXPECTED_ANY>[]} */
            callbacks,
            err,
            result
          );
        }
      );
    }
    /**
     * @param {PathLike | PathOrFileDescriptor} path path
     * @param {EXPECTED_ANY} options options
     * @returns {EXPECTED_ANY} result
     */
    provideSync(path2, options) {
      if (typeof path2 !== "string" && !Buffer.isBuffer(path2) && !(path2 instanceof URL) && typeof path2 !== "number") {
        throw new TypeError("path must be a string");
      }
      const strPath = typeof path2 !== "string" ? path2.toString() : path2;
      if (options) {
        return (
          /** @type {EXPECTED_FUNCTION} */
          this._syncProvider.call(
            this._providerContext,
            path2,
            options
          )
        );
      }
      if (this._mode === STORAGE_MODE_SYNC) {
        this._runDecays();
      }
      const cacheEntry = this._data.get(strPath);
      if (cacheEntry !== void 0) {
        if (cacheEntry.err) throw cacheEntry.err;
        return cacheEntry.result;
      }
      const callbacks = this._activeAsyncOperations.get(strPath);
      this._activeAsyncOperations.delete(strPath);
      let result;
      try {
        result = /** @type {EXPECTED_FUNCTION} */
        this._syncProvider.call(
          this._providerContext,
          path2
        );
      } catch (err) {
        this._storeResult(
          strPath,
          /** @type {Error} */
          err,
          void 0
        );
        this._enterSyncModeWhenIdle();
        if (callbacks) {
          runCallbacks(
            callbacks,
            /** @type {Error} */
            err,
            void 0
          );
        }
        throw err;
      }
      this._storeResult(strPath, null, result);
      this._enterSyncModeWhenIdle();
      if (callbacks) {
        runCallbacks(callbacks, null, result);
      }
      return result;
    }
    /**
     * @param {(string | Buffer | URL | number | (string | URL | Buffer | number)[] | Set<string | URL | Buffer | number>)=} what what to purge
     */
    purge(what) {
      if (!what) {
        if (this._mode !== STORAGE_MODE_IDLE) {
          this._data.clear();
          for (const level of this._levels) {
            level.clear();
          }
          this._enterIdleMode();
        }
      } else if (typeof what === "string" || Buffer.isBuffer(what) || what instanceof URL || typeof what === "number") {
        const strWhat = typeof what !== "string" ? what.toString() : what;
        for (const [key, data] of this._data) {
          if (key.startsWith(strWhat)) {
            this._data.delete(key);
            data.level.delete(key);
          }
        }
        if (this._data.size === 0) {
          this._enterIdleMode();
        }
      } else {
        for (const [key, data] of this._data) {
          for (const item of what) {
            const strItem = typeof item !== "string" ? item.toString() : item;
            if (key.startsWith(strItem)) {
              this._data.delete(key);
              data.level.delete(key);
              break;
            }
          }
        }
        if (this._data.size === 0) {
          this._enterIdleMode();
        }
      }
    }
    /**
     * @param {(string | Buffer | URL | number | (string | URL | Buffer | number)[] | Set<string | URL | Buffer | number>)=} what what to purge
     */
    purgeParent(what) {
      if (!what) {
        this.purge();
      } else if (typeof what === "string" || Buffer.isBuffer(what) || what instanceof URL || typeof what === "number") {
        const strWhat = typeof what !== "string" ? what.toString() : what;
        this.purge(dirname(strWhat));
      } else {
        const set = /* @__PURE__ */ new Set();
        for (const item of what) {
          const strItem = typeof item !== "string" ? item.toString() : item;
          set.add(dirname(strItem));
        }
        this.purge(set);
      }
    }
    /**
     * @param {string} path path
     * @param {Error | null} err error
     * @param {EXPECTED_ANY} result result
     */
    _storeResult(path2, err, result) {
      if (this._data.has(path2)) return;
      const level = this._levels[this._currentLevel];
      this._data.set(path2, { err, result, level });
      level.add(path2);
    }
    _decayLevel() {
      const nextLevel = (this._currentLevel + 1) % this._levels.length;
      const decay = this._levels[nextLevel];
      this._currentLevel = nextLevel;
      for (const item of decay) {
        this._data.delete(item);
      }
      decay.clear();
      if (this._data.size === 0) {
        this._enterIdleMode();
      } else {
        this._nextDecay += this._tickInterval;
      }
    }
    _runDecays() {
      while (
        /** @type {number} */
        this._nextDecay <= Date.now() && this._mode !== STORAGE_MODE_IDLE
      ) {
        this._decayLevel();
      }
    }
    _enterAsyncMode() {
      let timeout = 0;
      switch (this._mode) {
        case STORAGE_MODE_ASYNC:
          return;
        case STORAGE_MODE_IDLE:
          this._nextDecay = Date.now() + this._tickInterval;
          timeout = this._tickInterval;
          break;
        case STORAGE_MODE_SYNC:
          this._runDecays();
          if (
            /** @type {STORAGE_MODE_IDLE | STORAGE_MODE_SYNC | STORAGE_MODE_ASYNC} */
            this._mode === STORAGE_MODE_IDLE
          ) {
            return;
          }
          timeout = Math.max(
            0,
            /** @type {number} */
            this._nextDecay - Date.now()
          );
          break;
      }
      this._mode = STORAGE_MODE_ASYNC;
      const ref = setTimeout(() => {
        this._mode = STORAGE_MODE_SYNC;
        this._runDecays();
      }, timeout);
      if (ref.unref) ref.unref();
      this._timeout = ref;
    }
    _enterSyncModeWhenIdle() {
      if (this._mode === STORAGE_MODE_IDLE) {
        this._mode = STORAGE_MODE_SYNC;
        this._nextDecay = Date.now() + this._tickInterval;
      }
    }
    _enterIdleMode() {
      this._mode = STORAGE_MODE_IDLE;
      this._nextDecay = void 0;
      if (this._timeout) clearTimeout(this._timeout);
    }
  };
  __name(_CacheBackend, "CacheBackend");
  let CacheBackend = _CacheBackend;
  const createBackend = /* @__PURE__ */ __name((duration, provider, syncProvider, providerContext) => {
    if (duration > 0) {
      return new CacheBackend(duration, provider, syncProvider, providerContext);
    }
    return new OperationMergerBackend(provider, syncProvider, providerContext);
  }, "createBackend");
  CachedInputFileSystem_1 = (_a2 = class {
    /**
     * @param {BaseFileSystem} fileSystem file system
     * @param {number} duration duration in ms files are cached
     */
    constructor(fileSystem, duration) {
      this.fileSystem = fileSystem;
      this._lstatBackend = createBackend(
        duration,
        this.fileSystem.lstat,
        this.fileSystem.lstatSync,
        this.fileSystem
      );
      const lstat = this._lstatBackend.provide;
      this.lstat = /** @type {FileSystem["lstat"]} */
      lstat;
      const lstatSync = this._lstatBackend.provideSync;
      this.lstatSync = /** @type {SyncFileSystem["lstatSync"]} */
      lstatSync;
      this._statBackend = createBackend(
        duration,
        this.fileSystem.stat,
        this.fileSystem.statSync,
        this.fileSystem
      );
      const stat = this._statBackend.provide;
      this.stat = /** @type {FileSystem["stat"]} */
      stat;
      const statSync = this._statBackend.provideSync;
      this.statSync = /** @type {SyncFileSystem["statSync"]} */
      statSync;
      this._readdirBackend = createBackend(
        duration,
        this.fileSystem.readdir,
        this.fileSystem.readdirSync,
        this.fileSystem
      );
      const readdir = this._readdirBackend.provide;
      this.readdir = /** @type {FileSystem["readdir"]} */
      readdir;
      const readdirSync = this._readdirBackend.provideSync;
      this.readdirSync = /** @type {SyncFileSystem["readdirSync"]} */
      readdirSync;
      this._readFileBackend = createBackend(
        duration,
        this.fileSystem.readFile,
        this.fileSystem.readFileSync,
        this.fileSystem
      );
      const readFile = this._readFileBackend.provide;
      this.readFile = /** @type {FileSystem["readFile"]} */
      readFile;
      const readFileSync2 = this._readFileBackend.provideSync;
      this.readFileSync = /** @type {SyncFileSystem["readFileSync"]} */
      readFileSync2;
      this._readJsonBackend = createBackend(
        duration,
        // prettier-ignore
        this.fileSystem.readJson || this.readFile && /**
         * @param {string} path path
         * @param {FileSystemCallback<EXPECTED_ANY>} callback callback
         */
        ((path2, callback) => {
          this.readFile(path2, (err, buffer) => {
            if (err) return callback(err);
            if (!buffer || buffer.length === 0) {
              return callback(new Error("No file content"));
            }
            let data;
            try {
              data = JSON.parse(buffer.toString("utf8"));
            } catch (err_) {
              return callback(
                /** @type {Error} */
                err_
              );
            }
            callback(null, data);
          });
        }),
        // prettier-ignore
        this.fileSystem.readJsonSync || this.readFileSync && /**
         * @param {string} path path
         * @returns {EXPECTED_ANY} result
         */
        ((path2) => {
          const buffer = this.readFileSync(path2);
          const data = JSON.parse(buffer.toString("utf8"));
          return data;
        }),
        this.fileSystem
      );
      const readJson = this._readJsonBackend.provide;
      this.readJson = /** @type {FileSystem["readJson"]} */
      readJson;
      const readJsonSync = this._readJsonBackend.provideSync;
      this.readJsonSync = /** @type {SyncFileSystem["readJsonSync"]} */
      readJsonSync;
      this._readlinkBackend = createBackend(
        duration,
        this.fileSystem.readlink,
        this.fileSystem.readlinkSync,
        this.fileSystem
      );
      const readlink = this._readlinkBackend.provide;
      this.readlink = /** @type {FileSystem["readlink"]} */
      readlink;
      const readlinkSync = this._readlinkBackend.provideSync;
      this.readlinkSync = /** @type {SyncFileSystem["readlinkSync"]} */
      readlinkSync;
      this._realpathBackend = createBackend(
        duration,
        this.fileSystem.realpath,
        this.fileSystem.realpathSync,
        this.fileSystem
      );
      const realpath = this._realpathBackend.provide;
      this.realpath = /** @type {FileSystem["realpath"]} */
      realpath;
      const realpathSync = this._realpathBackend.provideSync;
      this.realpathSync = /** @type {SyncFileSystem["realpathSync"]} */
      realpathSync;
    }
    /**
     * @param {(string | Buffer | URL | number | (string | URL | Buffer | number)[] | Set<string | URL | Buffer | number>)=} what what to purge
     */
    purge(what) {
      this._statBackend.purge(what);
      this._lstatBackend.purge(what);
      this._readdirBackend.purgeParent(what);
      this._readFileBackend.purge(what);
      this._readlinkBackend.purge(what);
      this._readJsonBackend.purge(what);
      this._realpathBackend.purge(what);
    }
  }, __name(_a2, "CachedInputFileSystem"), _a2);
  return CachedInputFileSystem_1;
}
__name(requireCachedInputFileSystem, "requireCachedInputFileSystem");
var polyfills;
var hasRequiredPolyfills;
function requirePolyfills() {
  if (hasRequiredPolyfills) return polyfills;
  hasRequiredPolyfills = 1;
  var constants = require$$0$1;
  var origCwd = process.cwd;
  var cwd = null;
  var platform = process.env.GRACEFUL_FS_PLATFORM || process.platform;
  process.cwd = function() {
    if (!cwd)
      cwd = origCwd.call(process);
    return cwd;
  };
  try {
    process.cwd();
  } catch (er2) {
  }
  if (typeof process.chdir === "function") {
    var chdir = process.chdir;
    process.chdir = function(d2) {
      cwd = null;
      chdir.call(process, d2);
    };
    if (Object.setPrototypeOf) Object.setPrototypeOf(process.chdir, chdir);
  }
  polyfills = patch;
  function patch(fs) {
    if (constants.hasOwnProperty("O_SYMLINK") && process.version.match(/^v0\.6\.[0-2]|^v0\.5\./)) {
      patchLchmod(fs);
    }
    if (!fs.lutimes) {
      patchLutimes(fs);
    }
    fs.chown = chownFix(fs.chown);
    fs.fchown = chownFix(fs.fchown);
    fs.lchown = chownFix(fs.lchown);
    fs.chmod = chmodFix(fs.chmod);
    fs.fchmod = chmodFix(fs.fchmod);
    fs.lchmod = chmodFix(fs.lchmod);
    fs.chownSync = chownFixSync(fs.chownSync);
    fs.fchownSync = chownFixSync(fs.fchownSync);
    fs.lchownSync = chownFixSync(fs.lchownSync);
    fs.chmodSync = chmodFixSync(fs.chmodSync);
    fs.fchmodSync = chmodFixSync(fs.fchmodSync);
    fs.lchmodSync = chmodFixSync(fs.lchmodSync);
    fs.stat = statFix(fs.stat);
    fs.fstat = statFix(fs.fstat);
    fs.lstat = statFix(fs.lstat);
    fs.statSync = statFixSync(fs.statSync);
    fs.fstatSync = statFixSync(fs.fstatSync);
    fs.lstatSync = statFixSync(fs.lstatSync);
    if (fs.chmod && !fs.lchmod) {
      fs.lchmod = function(path2, mode, cb) {
        if (cb) process.nextTick(cb);
      };
      fs.lchmodSync = function() {
      };
    }
    if (fs.chown && !fs.lchown) {
      fs.lchown = function(path2, uid, gid, cb) {
        if (cb) process.nextTick(cb);
      };
      fs.lchownSync = function() {
      };
    }
    if (platform === "win32") {
      fs.rename = typeof fs.rename !== "function" ? fs.rename : function(fs$rename) {
        function rename(from, to, cb) {
          var start = Date.now();
          var backoff = 0;
          fs$rename(from, to, /* @__PURE__ */ __name(function CB(er2) {
            if (er2 && (er2.code === "EACCES" || er2.code === "EPERM" || er2.code === "EBUSY") && Date.now() - start < 6e4) {
              setTimeout(function() {
                fs.stat(to, function(stater, st) {
                  if (stater && stater.code === "ENOENT")
                    fs$rename(from, to, CB);
                  else
                    cb(er2);
                });
              }, backoff);
              if (backoff < 100)
                backoff += 10;
              return;
            }
            if (cb) cb(er2);
          }, "CB"));
        }
        __name(rename, "rename");
        if (Object.setPrototypeOf) Object.setPrototypeOf(rename, fs$rename);
        return rename;
      }(fs.rename);
    }
    fs.read = typeof fs.read !== "function" ? fs.read : function(fs$read) {
      function read(fd, buffer, offset, length, position, callback_) {
        var callback;
        if (callback_ && typeof callback_ === "function") {
          var eagCounter = 0;
          callback = /* @__PURE__ */ __name(function(er2, _, __) {
            if (er2 && er2.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              return fs$read.call(fs, fd, buffer, offset, length, position, callback);
            }
            callback_.apply(this, arguments);
          }, "callback");
        }
        return fs$read.call(fs, fd, buffer, offset, length, position, callback);
      }
      __name(read, "read");
      if (Object.setPrototypeOf) Object.setPrototypeOf(read, fs$read);
      return read;
    }(fs.read);
    fs.readSync = typeof fs.readSync !== "function" ? fs.readSync : /* @__PURE__ */ function(fs$readSync) {
      return function(fd, buffer, offset, length, position) {
        var eagCounter = 0;
        while (true) {
          try {
            return fs$readSync.call(fs, fd, buffer, offset, length, position);
          } catch (er2) {
            if (er2.code === "EAGAIN" && eagCounter < 10) {
              eagCounter++;
              continue;
            }
            throw er2;
          }
        }
      };
    }(fs.readSync);
    function patchLchmod(fs2) {
      fs2.lchmod = function(path2, mode, callback) {
        fs2.open(
          path2,
          constants.O_WRONLY | constants.O_SYMLINK,
          mode,
          function(err, fd) {
            if (err) {
              if (callback) callback(err);
              return;
            }
            fs2.fchmod(fd, mode, function(err2) {
              fs2.close(fd, function(err22) {
                if (callback) callback(err2 || err22);
              });
            });
          }
        );
      };
      fs2.lchmodSync = function(path2, mode) {
        var fd = fs2.openSync(path2, constants.O_WRONLY | constants.O_SYMLINK, mode);
        var threw = true;
        var ret;
        try {
          ret = fs2.fchmodSync(fd, mode);
          threw = false;
        } finally {
          if (threw) {
            try {
              fs2.closeSync(fd);
            } catch (er2) {
            }
          } else {
            fs2.closeSync(fd);
          }
        }
        return ret;
      };
    }
    __name(patchLchmod, "patchLchmod");
    function patchLutimes(fs2) {
      if (constants.hasOwnProperty("O_SYMLINK") && fs2.futimes) {
        fs2.lutimes = function(path2, at, mt, cb) {
          fs2.open(path2, constants.O_SYMLINK, function(er2, fd) {
            if (er2) {
              if (cb) cb(er2);
              return;
            }
            fs2.futimes(fd, at, mt, function(er3) {
              fs2.close(fd, function(er22) {
                if (cb) cb(er3 || er22);
              });
            });
          });
        };
        fs2.lutimesSync = function(path2, at, mt) {
          var fd = fs2.openSync(path2, constants.O_SYMLINK);
          var ret;
          var threw = true;
          try {
            ret = fs2.futimesSync(fd, at, mt);
            threw = false;
          } finally {
            if (threw) {
              try {
                fs2.closeSync(fd);
              } catch (er2) {
              }
            } else {
              fs2.closeSync(fd);
            }
          }
          return ret;
        };
      } else if (fs2.futimes) {
        fs2.lutimes = function(_a2, _b2, _c2, cb) {
          if (cb) process.nextTick(cb);
        };
        fs2.lutimesSync = function() {
        };
      }
    }
    __name(patchLutimes, "patchLutimes");
    function chmodFix(orig) {
      if (!orig) return orig;
      return function(target, mode, cb) {
        return orig.call(fs, target, mode, function(er2) {
          if (chownErOk(er2)) er2 = null;
          if (cb) cb.apply(this, arguments);
        });
      };
    }
    __name(chmodFix, "chmodFix");
    function chmodFixSync(orig) {
      if (!orig) return orig;
      return function(target, mode) {
        try {
          return orig.call(fs, target, mode);
        } catch (er2) {
          if (!chownErOk(er2)) throw er2;
        }
      };
    }
    __name(chmodFixSync, "chmodFixSync");
    function chownFix(orig) {
      if (!orig) return orig;
      return function(target, uid, gid, cb) {
        return orig.call(fs, target, uid, gid, function(er2) {
          if (chownErOk(er2)) er2 = null;
          if (cb) cb.apply(this, arguments);
        });
      };
    }
    __name(chownFix, "chownFix");
    function chownFixSync(orig) {
      if (!orig) return orig;
      return function(target, uid, gid) {
        try {
          return orig.call(fs, target, uid, gid);
        } catch (er2) {
          if (!chownErOk(er2)) throw er2;
        }
      };
    }
    __name(chownFixSync, "chownFixSync");
    function statFix(orig) {
      if (!orig) return orig;
      return function(target, options, cb) {
        if (typeof options === "function") {
          cb = options;
          options = null;
        }
        function callback(er2, stats) {
          if (stats) {
            if (stats.uid < 0) stats.uid += 4294967296;
            if (stats.gid < 0) stats.gid += 4294967296;
          }
          if (cb) cb.apply(this, arguments);
        }
        __name(callback, "callback");
        return options ? orig.call(fs, target, options, callback) : orig.call(fs, target, callback);
      };
    }
    __name(statFix, "statFix");
    function statFixSync(orig) {
      if (!orig) return orig;
      return function(target, options) {
        var stats = options ? orig.call(fs, target, options) : orig.call(fs, target);
        if (stats) {
          if (stats.uid < 0) stats.uid += 4294967296;
          if (stats.gid < 0) stats.gid += 4294967296;
        }
        return stats;
      };
    }
    __name(statFixSync, "statFixSync");
    function chownErOk(er2) {
      if (!er2)
        return true;
      if (er2.code === "ENOSYS")
        return true;
      var nonroot = !process.getuid || process.getuid() !== 0;
      if (nonroot) {
        if (er2.code === "EINVAL" || er2.code === "EPERM")
          return true;
      }
      return false;
    }
    __name(chownErOk, "chownErOk");
  }
  __name(patch, "patch");
  return polyfills;
}
__name(requirePolyfills, "requirePolyfills");
var legacyStreams;
var hasRequiredLegacyStreams;
function requireLegacyStreams() {
  if (hasRequiredLegacyStreams) return legacyStreams;
  hasRequiredLegacyStreams = 1;
  var Stream = require$$0$2.Stream;
  legacyStreams = legacy;
  function legacy(fs) {
    return {
      ReadStream,
      WriteStream
    };
    function ReadStream(path2, options) {
      if (!(this instanceof ReadStream)) return new ReadStream(path2, options);
      Stream.call(this);
      var self = this;
      this.path = path2;
      this.fd = null;
      this.readable = true;
      this.paused = false;
      this.flags = "r";
      this.mode = 438;
      this.bufferSize = 64 * 1024;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length; index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.encoding) this.setEncoding(this.encoding);
      if (this.start !== void 0) {
        if ("number" !== typeof this.start) {
          throw TypeError("start must be a Number");
        }
        if (this.end === void 0) {
          this.end = Infinity;
        } else if ("number" !== typeof this.end) {
          throw TypeError("end must be a Number");
        }
        if (this.start > this.end) {
          throw new Error("start must be <= end");
        }
        this.pos = this.start;
      }
      if (this.fd !== null) {
        process.nextTick(function() {
          self._read();
        });
        return;
      }
      fs.open(this.path, this.flags, this.mode, function(err, fd) {
        if (err) {
          self.emit("error", err);
          self.readable = false;
          return;
        }
        self.fd = fd;
        self.emit("open", fd);
        self._read();
      });
    }
    __name(ReadStream, "ReadStream");
    function WriteStream(path2, options) {
      if (!(this instanceof WriteStream)) return new WriteStream(path2, options);
      Stream.call(this);
      this.path = path2;
      this.fd = null;
      this.writable = true;
      this.flags = "w";
      this.encoding = "binary";
      this.mode = 438;
      this.bytesWritten = 0;
      options = options || {};
      var keys = Object.keys(options);
      for (var index = 0, length = keys.length; index < length; index++) {
        var key = keys[index];
        this[key] = options[key];
      }
      if (this.start !== void 0) {
        if ("number" !== typeof this.start) {
          throw TypeError("start must be a Number");
        }
        if (this.start < 0) {
          throw new Error("start must be >= zero");
        }
        this.pos = this.start;
      }
      this.busy = false;
      this._queue = [];
      if (this.fd === null) {
        this._open = fs.open;
        this._queue.push([this._open, this.path, this.flags, this.mode, void 0]);
        this.flush();
      }
    }
    __name(WriteStream, "WriteStream");
  }
  __name(legacy, "legacy");
  return legacyStreams;
}
__name(requireLegacyStreams, "requireLegacyStreams");
var clone_1;
var hasRequiredClone;
function requireClone() {
  if (hasRequiredClone) return clone_1;
  hasRequiredClone = 1;
  clone_1 = clone;
  var getPrototypeOf = Object.getPrototypeOf || function(obj) {
    return obj.__proto__;
  };
  function clone(obj) {
    if (obj === null || typeof obj !== "object")
      return obj;
    if (obj instanceof Object)
      var copy = { __proto__: getPrototypeOf(obj) };
    else
      var copy = /* @__PURE__ */ Object.create(null);
    Object.getOwnPropertyNames(obj).forEach(function(key) {
      Object.defineProperty(copy, key, Object.getOwnPropertyDescriptor(obj, key));
    });
    return copy;
  }
  __name(clone, "clone");
  return clone_1;
}
__name(requireClone, "requireClone");
var gracefulFs;
var hasRequiredGracefulFs;
function requireGracefulFs() {
  if (hasRequiredGracefulFs) return gracefulFs;
  hasRequiredGracefulFs = 1;
  var fs = fs5__default;
  var polyfills2 = requirePolyfills();
  var legacy = requireLegacyStreams();
  var clone = requireClone();
  var util2 = require$$0$3;
  var gracefulQueue;
  var previousSymbol;
  if (typeof Symbol === "function" && typeof Symbol.for === "function") {
    gracefulQueue = Symbol.for("graceful-fs.queue");
    previousSymbol = Symbol.for("graceful-fs.previous");
  } else {
    gracefulQueue = "___graceful-fs.queue";
    previousSymbol = "___graceful-fs.previous";
  }
  function noop() {
  }
  __name(noop, "noop");
  function publishQueue(context, queue2) {
    Object.defineProperty(context, gracefulQueue, {
      get: /* @__PURE__ */ __name(function() {
        return queue2;
      }, "get")
    });
  }
  __name(publishQueue, "publishQueue");
  var debug = noop;
  if (util2.debuglog)
    debug = util2.debuglog("gfs4");
  else if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || ""))
    debug = /* @__PURE__ */ __name(function() {
      var m = util2.format.apply(util2, arguments);
      m = "GFS4: " + m.split(/\n/).join("\nGFS4: ");
      console.error(m);
    }, "debug");
  if (!fs[gracefulQueue]) {
    var queue = commonjsGlobal[gracefulQueue] || [];
    publishQueue(fs, queue);
    fs.close = function(fs$close) {
      function close(fd, cb) {
        return fs$close.call(fs, fd, function(err) {
          if (!err) {
            resetQueue();
          }
          if (typeof cb === "function")
            cb.apply(this, arguments);
        });
      }
      __name(close, "close");
      Object.defineProperty(close, previousSymbol, {
        value: fs$close
      });
      return close;
    }(fs.close);
    fs.closeSync = function(fs$closeSync) {
      function closeSync(fd) {
        fs$closeSync.apply(fs, arguments);
        resetQueue();
      }
      __name(closeSync, "closeSync");
      Object.defineProperty(closeSync, previousSymbol, {
        value: fs$closeSync
      });
      return closeSync;
    }(fs.closeSync);
    if (/\bgfs4\b/i.test(process.env.NODE_DEBUG || "")) {
      process.on("exit", function() {
        debug(fs[gracefulQueue]);
        require$$5.equal(fs[gracefulQueue].length, 0);
      });
    }
  }
  if (!commonjsGlobal[gracefulQueue]) {
    publishQueue(commonjsGlobal, fs[gracefulQueue]);
  }
  gracefulFs = patch(clone(fs));
  if (process.env.TEST_GRACEFUL_FS_GLOBAL_PATCH && !fs.__patched) {
    gracefulFs = patch(fs);
    fs.__patched = true;
  }
  function patch(fs2) {
    polyfills2(fs2);
    fs2.gracefulify = patch;
    fs2.createReadStream = createReadStream;
    fs2.createWriteStream = createWriteStream;
    var fs$readFile = fs2.readFile;
    fs2.readFile = readFile;
    function readFile(path2, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$readFile(path2, options, cb);
      function go$readFile(path3, options2, cb2, startTime) {
        return fs$readFile(path3, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$readFile, [path3, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
      __name(go$readFile, "go$readFile");
    }
    __name(readFile, "readFile");
    var fs$writeFile = fs2.writeFile;
    fs2.writeFile = writeFile;
    function writeFile(path2, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$writeFile(path2, data, options, cb);
      function go$writeFile(path3, data2, options2, cb2, startTime) {
        return fs$writeFile(path3, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$writeFile, [path3, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
      __name(go$writeFile, "go$writeFile");
    }
    __name(writeFile, "writeFile");
    var fs$appendFile = fs2.appendFile;
    if (fs$appendFile)
      fs2.appendFile = appendFile;
    function appendFile(path2, data, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      return go$appendFile(path2, data, options, cb);
      function go$appendFile(path3, data2, options2, cb2, startTime) {
        return fs$appendFile(path3, data2, options2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$appendFile, [path3, data2, options2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
      __name(go$appendFile, "go$appendFile");
    }
    __name(appendFile, "appendFile");
    var fs$copyFile = fs2.copyFile;
    if (fs$copyFile)
      fs2.copyFile = copyFile;
    function copyFile(src, dest, flags, cb) {
      if (typeof flags === "function") {
        cb = flags;
        flags = 0;
      }
      return go$copyFile(src, dest, flags, cb);
      function go$copyFile(src2, dest2, flags2, cb2, startTime) {
        return fs$copyFile(src2, dest2, flags2, function(err) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$copyFile, [src2, dest2, flags2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
      __name(go$copyFile, "go$copyFile");
    }
    __name(copyFile, "copyFile");
    var fs$readdir = fs2.readdir;
    fs2.readdir = readdir;
    var noReaddirOptionVersions = /^v[0-5]\./;
    function readdir(path2, options, cb) {
      if (typeof options === "function")
        cb = options, options = null;
      var go$readdir = noReaddirOptionVersions.test(process.version) ? /* @__PURE__ */ __name(function go$readdir2(path3, options2, cb2, startTime) {
        return fs$readdir(path3, fs$readdirCallback(
          path3,
          options2,
          cb2,
          startTime
        ));
      }, "go$readdir") : /* @__PURE__ */ __name(function go$readdir2(path3, options2, cb2, startTime) {
        return fs$readdir(path3, options2, fs$readdirCallback(
          path3,
          options2,
          cb2,
          startTime
        ));
      }, "go$readdir");
      return go$readdir(path2, options, cb);
      function fs$readdirCallback(path3, options2, cb2, startTime) {
        return function(err, files2) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([
              go$readdir,
              [path3, options2, cb2],
              err,
              startTime || Date.now(),
              Date.now()
            ]);
          else {
            if (files2 && files2.sort)
              files2.sort();
            if (typeof cb2 === "function")
              cb2.call(this, err, files2);
          }
        };
      }
      __name(fs$readdirCallback, "fs$readdirCallback");
    }
    __name(readdir, "readdir");
    if (process.version.substr(0, 4) === "v0.8") {
      var legStreams = legacy(fs2);
      ReadStream = legStreams.ReadStream;
      WriteStream = legStreams.WriteStream;
    }
    var fs$ReadStream = fs2.ReadStream;
    if (fs$ReadStream) {
      ReadStream.prototype = Object.create(fs$ReadStream.prototype);
      ReadStream.prototype.open = ReadStream$open;
    }
    var fs$WriteStream = fs2.WriteStream;
    if (fs$WriteStream) {
      WriteStream.prototype = Object.create(fs$WriteStream.prototype);
      WriteStream.prototype.open = WriteStream$open;
    }
    Object.defineProperty(fs2, "ReadStream", {
      get: /* @__PURE__ */ __name(function() {
        return ReadStream;
      }, "get"),
      set: /* @__PURE__ */ __name(function(val) {
        ReadStream = val;
      }, "set"),
      enumerable: true,
      configurable: true
    });
    Object.defineProperty(fs2, "WriteStream", {
      get: /* @__PURE__ */ __name(function() {
        return WriteStream;
      }, "get"),
      set: /* @__PURE__ */ __name(function(val) {
        WriteStream = val;
      }, "set"),
      enumerable: true,
      configurable: true
    });
    var FileReadStream = ReadStream;
    Object.defineProperty(fs2, "FileReadStream", {
      get: /* @__PURE__ */ __name(function() {
        return FileReadStream;
      }, "get"),
      set: /* @__PURE__ */ __name(function(val) {
        FileReadStream = val;
      }, "set"),
      enumerable: true,
      configurable: true
    });
    var FileWriteStream = WriteStream;
    Object.defineProperty(fs2, "FileWriteStream", {
      get: /* @__PURE__ */ __name(function() {
        return FileWriteStream;
      }, "get"),
      set: /* @__PURE__ */ __name(function(val) {
        FileWriteStream = val;
      }, "set"),
      enumerable: true,
      configurable: true
    });
    function ReadStream(path2, options) {
      if (this instanceof ReadStream)
        return fs$ReadStream.apply(this, arguments), this;
      else
        return ReadStream.apply(Object.create(ReadStream.prototype), arguments);
    }
    __name(ReadStream, "ReadStream");
    function ReadStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          if (that.autoClose)
            that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
          that.read();
        }
      });
    }
    __name(ReadStream$open, "ReadStream$open");
    function WriteStream(path2, options) {
      if (this instanceof WriteStream)
        return fs$WriteStream.apply(this, arguments), this;
      else
        return WriteStream.apply(Object.create(WriteStream.prototype), arguments);
    }
    __name(WriteStream, "WriteStream");
    function WriteStream$open() {
      var that = this;
      open(that.path, that.flags, that.mode, function(err, fd) {
        if (err) {
          that.destroy();
          that.emit("error", err);
        } else {
          that.fd = fd;
          that.emit("open", fd);
        }
      });
    }
    __name(WriteStream$open, "WriteStream$open");
    function createReadStream(path2, options) {
      return new fs2.ReadStream(path2, options);
    }
    __name(createReadStream, "createReadStream");
    function createWriteStream(path2, options) {
      return new fs2.WriteStream(path2, options);
    }
    __name(createWriteStream, "createWriteStream");
    var fs$open = fs2.open;
    fs2.open = open;
    function open(path2, flags, mode, cb) {
      if (typeof mode === "function")
        cb = mode, mode = null;
      return go$open(path2, flags, mode, cb);
      function go$open(path3, flags2, mode2, cb2, startTime) {
        return fs$open(path3, flags2, mode2, function(err, fd) {
          if (err && (err.code === "EMFILE" || err.code === "ENFILE"))
            enqueue([go$open, [path3, flags2, mode2, cb2], err, startTime || Date.now(), Date.now()]);
          else {
            if (typeof cb2 === "function")
              cb2.apply(this, arguments);
          }
        });
      }
      __name(go$open, "go$open");
    }
    __name(open, "open");
    return fs2;
  }
  __name(patch, "patch");
  function enqueue(elem) {
    debug("ENQUEUE", elem[0].name, elem[1]);
    fs[gracefulQueue].push(elem);
    retry();
  }
  __name(enqueue, "enqueue");
  var retryTimer;
  function resetQueue() {
    var now = Date.now();
    for (var i2 = 0; i2 < fs[gracefulQueue].length; ++i2) {
      if (fs[gracefulQueue][i2].length > 2) {
        fs[gracefulQueue][i2][3] = now;
        fs[gracefulQueue][i2][4] = now;
      }
    }
    retry();
  }
  __name(resetQueue, "resetQueue");
  function retry() {
    clearTimeout(retryTimer);
    retryTimer = void 0;
    if (fs[gracefulQueue].length === 0)
      return;
    var elem = fs[gracefulQueue].shift();
    var fn = elem[0];
    var args = elem[1];
    var err = elem[2];
    var startTime = elem[3];
    var lastTime = elem[4];
    if (startTime === void 0) {
      debug("RETRY", fn.name, args);
      fn.apply(null, args);
    } else if (Date.now() - startTime >= 6e4) {
      debug("TIMEOUT", fn.name, args);
      var cb = args.pop();
      if (typeof cb === "function")
        cb.call(null, err);
    } else {
      var sinceAttempt = Date.now() - lastTime;
      var sinceStart = Math.max(lastTime - startTime, 1);
      var desiredDelay = Math.min(sinceStart * 1.2, 100);
      if (sinceAttempt >= desiredDelay) {
        debug("RETRY", fn.name, args);
        fn.apply(null, args.concat([startTime]));
      } else {
        fs[gracefulQueue].push(elem);
      }
    }
    if (retryTimer === void 0) {
      retryTimer = setTimeout(retry, 0);
    }
  }
  __name(retry, "retry");
  return gracefulFs;
}
__name(requireGracefulFs, "requireGracefulFs");
var ResolverFactory = {};
var DescriptionFileUtils = {};
var forEachBail;
var hasRequiredForEachBail;
function requireForEachBail() {
  if (hasRequiredForEachBail) return forEachBail;
  hasRequiredForEachBail = 1;
  forEachBail = /* @__PURE__ */ __name(function forEachBail2(array, iterator, callback) {
    if (array.length === 0) return callback();
    let i2 = 0;
    const next = /* @__PURE__ */ __name(() => {
      let loop;
      iterator(
        array[i2++],
        (err, result) => {
          if (err || result !== void 0 || i2 >= array.length) {
            return callback(err, result, i2);
          }
          if (loop === false) while (next()) ;
          loop = true;
        },
        i2
      );
      if (!loop) loop = false;
      return loop;
    }, "next");
    while (next()) ;
  }, "forEachBail");
  return forEachBail;
}
__name(requireForEachBail, "requireForEachBail");
var hasRequiredDescriptionFileUtils;
function requireDescriptionFileUtils() {
  if (hasRequiredDescriptionFileUtils) return DescriptionFileUtils;
  hasRequiredDescriptionFileUtils = 1;
  const forEachBail2 = requireForEachBail();
  function cdUp(directory) {
    if (directory === "/") return null;
    const i2 = directory.lastIndexOf("/");
    const j = directory.lastIndexOf("\\");
    const path2 = i2 < 0 ? j : j < 0 ? i2 : i2 < j ? j : i2;
    if (path2 < 0) return null;
    return directory.slice(0, path2 || 1);
  }
  __name(cdUp, "cdUp");
  function loadDescriptionFile(resolver2, directory, filenames, oldInfo, resolveContext, callback) {
    (/* @__PURE__ */ __name(function findDescriptionFile() {
      if (oldInfo && oldInfo.directory === directory) {
        return callback(null, oldInfo);
      }
      forEachBail2(
        filenames,
        /**
         * @param {string} filename filename
         * @param {(err?: null|Error, result?: null|Result) => void} callback callback
         * @returns {void}
         */
        (filename, callback2) => {
          const descriptionFilePath = resolver2.join(directory, filename);
          function onJson(err, resolvedContent) {
            if (err) {
              if (resolveContext.log) {
                resolveContext.log(
                  `${descriptionFilePath} (directory description file): ${err}`
                );
              } else {
                err.message = `${descriptionFilePath} (directory description file): ${err}`;
              }
              return callback2(err);
            }
            callback2(null, {
              content: (
                /** @type {JsonObject} */
                resolvedContent
              ),
              directory,
              path: descriptionFilePath
            });
          }
          __name(onJson, "onJson");
          if (resolver2.fileSystem.readJson) {
            resolver2.fileSystem.readJson(descriptionFilePath, (err, content) => {
              if (err) {
                if (typeof /** @type {NodeJS.ErrnoException} */
                err.code !== "undefined") {
                  if (resolveContext.missingDependencies) {
                    resolveContext.missingDependencies.add(descriptionFilePath);
                  }
                  return callback2();
                }
                if (resolveContext.fileDependencies) {
                  resolveContext.fileDependencies.add(descriptionFilePath);
                }
                return onJson(err);
              }
              if (resolveContext.fileDependencies) {
                resolveContext.fileDependencies.add(descriptionFilePath);
              }
              onJson(null, content);
            });
          } else {
            resolver2.fileSystem.readFile(descriptionFilePath, (err, content) => {
              if (err) {
                if (resolveContext.missingDependencies) {
                  resolveContext.missingDependencies.add(descriptionFilePath);
                }
                return callback2();
              }
              if (resolveContext.fileDependencies) {
                resolveContext.fileDependencies.add(descriptionFilePath);
              }
              let json;
              if (content) {
                try {
                  json = JSON.parse(content.toString());
                } catch (err_) {
                  return onJson(
                    /** @type {Error} */
                    err_
                  );
                }
              } else {
                return onJson(new Error("No content in file"));
              }
              onJson(null, json);
            });
          }
        },
        /**
         * @param {(null | Error)=} err error
         * @param {(null | Result)=} result result
         * @returns {void}
         */
        (err, result) => {
          if (err) return callback(err);
          if (result) return callback(null, result);
          const dir = cdUp(directory);
          if (!dir) {
            return callback();
          }
          directory = dir;
          return findDescriptionFile();
        }
      );
    }, "findDescriptionFile"))();
  }
  __name(loadDescriptionFile, "loadDescriptionFile");
  function getField(content, field) {
    if (!content) return void 0;
    if (Array.isArray(field)) {
      let current = content;
      for (let j = 0; j < field.length; j++) {
        if (current === null || typeof current !== "object") {
          current = null;
          break;
        }
        current = /** @type {JsonValue} */
        /** @type {JsonObject} */
        current[field[j]];
      }
      return current;
    }
    return content[field];
  }
  __name(getField, "getField");
  DescriptionFileUtils.cdUp = cdUp;
  DescriptionFileUtils.getField = getField;
  DescriptionFileUtils.loadDescriptionFile = loadDescriptionFile;
  return DescriptionFileUtils;
}
__name(requireDescriptionFileUtils, "requireDescriptionFileUtils");
var getInnerRequest;
var hasRequiredGetInnerRequest;
function requireGetInnerRequest() {
  if (hasRequiredGetInnerRequest) return getInnerRequest;
  hasRequiredGetInnerRequest = 1;
  getInnerRequest = /* @__PURE__ */ __name(function getInnerRequest2(resolver2, request) {
    if (typeof request.__innerRequest === "string" && request.__innerRequest_request === request.request && request.__innerRequest_relativePath === request.relativePath) {
      return request.__innerRequest;
    }
    let innerRequest;
    if (request.request) {
      innerRequest = request.request;
      if (/^\.\.?(?:\/|$)/.test(innerRequest) && request.relativePath) {
        innerRequest = resolver2.join(request.relativePath, innerRequest);
      }
    } else {
      innerRequest = request.relativePath;
    }
    request.__innerRequest_request = request.request;
    request.__innerRequest_relativePath = request.relativePath;
    return request.__innerRequest = /** @type {string} */
    innerRequest;
  }, "getInnerRequest");
  return getInnerRequest;
}
__name(requireGetInnerRequest, "requireGetInnerRequest");
var AliasFieldPlugin_1;
var hasRequiredAliasFieldPlugin;
function requireAliasFieldPlugin() {
  var _a2;
  if (hasRequiredAliasFieldPlugin) return AliasFieldPlugin_1;
  hasRequiredAliasFieldPlugin = 1;
  const DescriptionFileUtils2 = requireDescriptionFileUtils();
  const getInnerRequest2 = requireGetInnerRequest();
  AliasFieldPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | Array<string>} field field
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, field, target) {
      this.source = source;
      this.field = field;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("AliasFieldPlugin", (request, resolveContext, callback) => {
        if (!request.descriptionFileData) return callback();
        const innerRequest = getInnerRequest2(resolver2, request);
        if (!innerRequest) return callback();
        const fieldData = DescriptionFileUtils2.getField(
          request.descriptionFileData,
          this.field
        );
        if (fieldData === null || typeof fieldData !== "object") {
          if (resolveContext.log) {
            resolveContext.log(
              `Field '${this.field}' doesn't contain a valid alias configuration`
            );
          }
          return callback();
        }
        const data = Object.prototype.hasOwnProperty.call(
          fieldData,
          innerRequest
        ) ? (
          /** @type {{[Key in string]: JsonPrimitive}} */
          fieldData[innerRequest]
        ) : innerRequest.startsWith("./") ? (
          /** @type {{[Key in string]: JsonPrimitive}} */
          fieldData[innerRequest.slice(2)]
        ) : void 0;
        if (data === innerRequest) return callback();
        if (data === void 0) return callback();
        if (data === false) {
          const ignoreObj = {
            ...request,
            path: false
          };
          if (typeof resolveContext.yield === "function") {
            resolveContext.yield(ignoreObj);
            return callback(null, null);
          }
          return callback(null, ignoreObj);
        }
        const obj = {
          ...request,
          path: (
            /** @type {string} */
            request.descriptionFileRoot
          ),
          request: (
            /** @type {string} */
            data
          ),
          fullySpecified: false
        };
        resolver2.doResolve(
          target,
          obj,
          `aliased from description file ${request.descriptionFilePath} with mapping '${innerRequest}' to '${/** @type {string} */
          data}'`,
          resolveContext,
          (err, result) => {
            if (err) return callback(err);
            if (result === void 0) return callback(null, null);
            callback(null, result);
          }
        );
      });
    }
  }, __name(_a2, "AliasFieldPlugin"), _a2);
  return AliasFieldPlugin_1;
}
__name(requireAliasFieldPlugin, "requireAliasFieldPlugin");
var path = {};
var hasRequiredPath;
function requirePath() {
  if (hasRequiredPath) return path;
  hasRequiredPath = 1;
  const path$1 = path9__default;
  const CHAR_HASH = "#".charCodeAt(0);
  const CHAR_SLASH = "/".charCodeAt(0);
  const CHAR_BACKSLASH = "\\".charCodeAt(0);
  const CHAR_A = "A".charCodeAt(0);
  const CHAR_Z = "Z".charCodeAt(0);
  const CHAR_LOWER_A = "a".charCodeAt(0);
  const CHAR_LOWER_Z = "z".charCodeAt(0);
  const CHAR_DOT = ".".charCodeAt(0);
  const CHAR_COLON = ":".charCodeAt(0);
  const posixNormalize = path$1.posix.normalize;
  const winNormalize = path$1.win32.normalize;
  const PathType = Object.freeze({
    Empty: 0,
    Normal: 1,
    Relative: 2,
    AbsoluteWin: 3,
    AbsolutePosix: 4,
    Internal: 5
  });
  const deprecatedInvalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i;
  const invalidSegmentRegEx = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))?(\\|\/|$)/i;
  const getType = /* @__PURE__ */ __name((maybePath) => {
    switch (maybePath.length) {
      case 0:
        return PathType.Empty;
      case 1: {
        const c02 = maybePath.charCodeAt(0);
        switch (c02) {
          case CHAR_DOT:
            return PathType.Relative;
          case CHAR_SLASH:
            return PathType.AbsolutePosix;
          case CHAR_HASH:
            return PathType.Internal;
        }
        return PathType.Normal;
      }
      case 2: {
        const c02 = maybePath.charCodeAt(0);
        switch (c02) {
          case CHAR_DOT: {
            const c13 = maybePath.charCodeAt(1);
            switch (c13) {
              case CHAR_DOT:
              case CHAR_SLASH:
                return PathType.Relative;
            }
            return PathType.Normal;
          }
          case CHAR_SLASH:
            return PathType.AbsolutePosix;
          case CHAR_HASH:
            return PathType.Internal;
        }
        const c12 = maybePath.charCodeAt(1);
        if (c12 === CHAR_COLON && (c02 >= CHAR_A && c02 <= CHAR_Z || c02 >= CHAR_LOWER_A && c02 <= CHAR_LOWER_Z)) {
          return PathType.AbsoluteWin;
        }
        return PathType.Normal;
      }
    }
    const c0 = maybePath.charCodeAt(0);
    switch (c0) {
      case CHAR_DOT: {
        const c12 = maybePath.charCodeAt(1);
        switch (c12) {
          case CHAR_SLASH:
            return PathType.Relative;
          case CHAR_DOT: {
            const c2 = maybePath.charCodeAt(2);
            if (c2 === CHAR_SLASH) return PathType.Relative;
            return PathType.Normal;
          }
        }
        return PathType.Normal;
      }
      case CHAR_SLASH:
        return PathType.AbsolutePosix;
      case CHAR_HASH:
        return PathType.Internal;
    }
    const c1 = maybePath.charCodeAt(1);
    if (c1 === CHAR_COLON) {
      const c2 = maybePath.charCodeAt(2);
      if ((c2 === CHAR_BACKSLASH || c2 === CHAR_SLASH) && (c0 >= CHAR_A && c0 <= CHAR_Z || c0 >= CHAR_LOWER_A && c0 <= CHAR_LOWER_Z)) {
        return PathType.AbsoluteWin;
      }
    }
    return PathType.Normal;
  }, "getType");
  const normalize = /* @__PURE__ */ __name((maybePath) => {
    switch (getType(maybePath)) {
      case PathType.Empty:
        return maybePath;
      case PathType.AbsoluteWin:
        return winNormalize(maybePath);
      case PathType.Relative: {
        const r = posixNormalize(maybePath);
        return getType(r) === PathType.Relative ? r : `./${r}`;
      }
    }
    return posixNormalize(maybePath);
  }, "normalize");
  const join = /* @__PURE__ */ __name((rootPath, request) => {
    if (!request) return normalize(rootPath);
    const requestType = getType(request);
    switch (requestType) {
      case PathType.AbsolutePosix:
        return posixNormalize(request);
      case PathType.AbsoluteWin:
        return winNormalize(request);
    }
    switch (getType(rootPath)) {
      case PathType.Normal:
      case PathType.Relative:
      case PathType.AbsolutePosix:
        return posixNormalize(`${rootPath}/${request}`);
      case PathType.AbsoluteWin:
        return winNormalize(`${rootPath}\\${request}`);
    }
    switch (requestType) {
      case PathType.Empty:
        return rootPath;
      case PathType.Relative: {
        const r = posixNormalize(rootPath);
        return getType(r) === PathType.Relative ? r : `./${r}`;
      }
    }
    return posixNormalize(rootPath);
  }, "join");
  const joinCache = /* @__PURE__ */ new Map();
  const cachedJoin = /* @__PURE__ */ __name((rootPath, request) => {
    let cacheEntry;
    let cache = joinCache.get(rootPath);
    if (cache === void 0) {
      joinCache.set(rootPath, cache = /* @__PURE__ */ new Map());
    } else {
      cacheEntry = cache.get(request);
      if (cacheEntry !== void 0) return cacheEntry;
    }
    cacheEntry = join(rootPath, request);
    cache.set(request, cacheEntry);
    return cacheEntry;
  }, "cachedJoin");
  path.PathType = PathType;
  path.cachedJoin = cachedJoin;
  path.deprecatedInvalidSegmentRegEx = deprecatedInvalidSegmentRegEx;
  path.getType = getType;
  path.invalidSegmentRegEx = invalidSegmentRegEx;
  path.join = join;
  path.normalize = normalize;
  return path;
}
__name(requirePath, "requirePath");
var AliasPlugin_1;
var hasRequiredAliasPlugin;
function requireAliasPlugin() {
  var _a2;
  if (hasRequiredAliasPlugin) return AliasPlugin_1;
  hasRequiredAliasPlugin = 1;
  const forEachBail2 = requireForEachBail();
  const { PathType, getType } = requirePath();
  AliasPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {AliasOption | Array<AliasOption>} options options
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, options, target) {
      this.source = source;
      this.options = Array.isArray(options) ? options : [options];
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      const getAbsolutePathWithSlashEnding = /* @__PURE__ */ __name((maybeAbsolutePath) => {
        const type = getType(maybeAbsolutePath);
        if (type === PathType.AbsolutePosix || type === PathType.AbsoluteWin) {
          return resolver2.join(maybeAbsolutePath, "_").slice(0, -1);
        }
        return null;
      }, "getAbsolutePathWithSlashEnding");
      const isSubPath = /* @__PURE__ */ __name((path2, maybeSubPath) => {
        const absolutePath = getAbsolutePathWithSlashEnding(maybeSubPath);
        if (!absolutePath) return false;
        return path2.startsWith(absolutePath);
      }, "isSubPath");
      resolver2.getHook(this.source).tapAsync("AliasPlugin", (request, resolveContext, callback) => {
        const innerRequest = request.request || request.path;
        if (!innerRequest) return callback();
        forEachBail2(
          this.options,
          (item, callback2) => {
            let shouldStop = false;
            const matchRequest = innerRequest === item.name || !item.onlyModule && (request.request ? innerRequest.startsWith(`${item.name}/`) : isSubPath(innerRequest, item.name));
            const splitName = item.name.split("*");
            const matchWildcard = !item.onlyModule && splitName.length === 2;
            if (matchRequest || matchWildcard) {
              const resolveWithAlias = /* @__PURE__ */ __name((alias, callback3) => {
                if (alias === false) {
                  const ignoreObj = {
                    ...request,
                    path: false
                  };
                  if (typeof resolveContext.yield === "function") {
                    resolveContext.yield(ignoreObj);
                    return callback3(null, null);
                  }
                  return callback3(null, ignoreObj);
                }
                let newRequestStr;
                const [prefix, suffix] = splitName;
                if (matchWildcard && innerRequest.startsWith(prefix) && innerRequest.endsWith(suffix)) {
                  const match = innerRequest.slice(
                    prefix.length,
                    innerRequest.length - suffix.length
                  );
                  newRequestStr = item.alias.toString().replace("*", match);
                }
                if (matchRequest && innerRequest !== alias && !innerRequest.startsWith(`${alias}/`)) {
                  const remainingRequest = innerRequest.slice(item.name.length);
                  newRequestStr = alias + remainingRequest;
                }
                if (newRequestStr !== void 0) {
                  shouldStop = true;
                  const obj = {
                    ...request,
                    request: newRequestStr,
                    fullySpecified: false
                  };
                  return resolver2.doResolve(
                    target,
                    obj,
                    `aliased with mapping '${item.name}': '${alias}' to '${newRequestStr}'`,
                    resolveContext,
                    (err, result) => {
                      if (err) return callback3(err);
                      if (result) return callback3(null, result);
                      return callback3();
                    }
                  );
                }
                return callback3();
              }, "resolveWithAlias");
              const stoppingCallback = /* @__PURE__ */ __name((err, result) => {
                if (err) return callback2(err);
                if (result) return callback2(null, result);
                if (shouldStop) return callback2(null, null);
                return callback2();
              }, "stoppingCallback");
              if (Array.isArray(item.alias)) {
                return forEachBail2(
                  item.alias,
                  resolveWithAlias,
                  stoppingCallback
                );
              }
              return resolveWithAlias(item.alias, stoppingCallback);
            }
            return callback2();
          },
          callback
        );
      });
    }
  }, __name(_a2, "AliasPlugin"), _a2);
  return AliasPlugin_1;
}
__name(requireAliasPlugin, "requireAliasPlugin");
var AppendPlugin_1;
var hasRequiredAppendPlugin;
function requireAppendPlugin() {
  var _a2;
  if (hasRequiredAppendPlugin) return AppendPlugin_1;
  hasRequiredAppendPlugin = 1;
  AppendPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string} appending appending
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, appending, target) {
      this.source = source;
      this.appending = appending;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("AppendPlugin", (request, resolveContext, callback) => {
        const obj = {
          ...request,
          path: request.path + this.appending,
          relativePath: request.relativePath && request.relativePath + this.appending
        };
        resolver2.doResolve(
          target,
          obj,
          this.appending,
          resolveContext,
          callback
        );
      });
    }
  }, __name(_a2, "AppendPlugin"), _a2);
  return AppendPlugin_1;
}
__name(requireAppendPlugin, "requireAppendPlugin");
var ConditionalPlugin_1;
var hasRequiredConditionalPlugin;
function requireConditionalPlugin() {
  var _a2;
  if (hasRequiredConditionalPlugin) return ConditionalPlugin_1;
  hasRequiredConditionalPlugin = 1;
  ConditionalPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {Partial<ResolveRequest>} test compare object
     * @param {string | null} message log message
     * @param {boolean} allowAlternatives when false, do not continue with the current step when "test" matches
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, test, message, allowAlternatives, target) {
      this.source = source;
      this.test = test;
      this.message = message;
      this.allowAlternatives = allowAlternatives;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      const { test, message, allowAlternatives } = this;
      const keys = (
        /** @type {(keyof ResolveRequest)[]} */
        Object.keys(test)
      );
      resolver2.getHook(this.source).tapAsync("ConditionalPlugin", (request, resolveContext, callback) => {
        for (const prop of keys) {
          if (request[prop] !== test[prop]) return callback();
        }
        resolver2.doResolve(
          target,
          request,
          message,
          resolveContext,
          allowAlternatives ? callback : (err, result) => {
            if (err) return callback(err);
            if (result === void 0) return callback(null, null);
            callback(null, result);
          }
        );
      });
    }
  }, __name(_a2, "ConditionalPlugin"), _a2);
  return ConditionalPlugin_1;
}
__name(requireConditionalPlugin, "requireConditionalPlugin");
var DescriptionFilePlugin_1;
var hasRequiredDescriptionFilePlugin;
function requireDescriptionFilePlugin() {
  var _a2;
  if (hasRequiredDescriptionFilePlugin) return DescriptionFilePlugin_1;
  hasRequiredDescriptionFilePlugin = 1;
  const DescriptionFileUtils2 = requireDescriptionFileUtils();
  DescriptionFilePlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string[]} filenames filenames
     * @param {boolean} pathIsFile pathIsFile
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, filenames, pathIsFile, target) {
      this.source = source;
      this.filenames = filenames;
      this.pathIsFile = pathIsFile;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync(
        "DescriptionFilePlugin",
        (request, resolveContext, callback) => {
          const { path: path2 } = request;
          if (!path2) return callback();
          const directory = this.pathIsFile ? DescriptionFileUtils2.cdUp(path2) : path2;
          if (!directory) return callback();
          DescriptionFileUtils2.loadDescriptionFile(
            resolver2,
            directory,
            this.filenames,
            request.descriptionFilePath ? {
              path: request.descriptionFilePath,
              content: request.descriptionFileData,
              directory: (
                /** @type {string} */
                request.descriptionFileRoot
              )
            } : void 0,
            resolveContext,
            (err, result) => {
              if (err) return callback(err);
              if (!result) {
                if (resolveContext.log) {
                  resolveContext.log(
                    `No description file found in ${directory} or above`
                  );
                }
                return callback();
              }
              const relativePath = `.${path2.slice(result.directory.length).replace(/\\/g, "/")}`;
              const obj = {
                ...request,
                descriptionFilePath: result.path,
                descriptionFileData: result.content,
                descriptionFileRoot: result.directory,
                relativePath
              };
              resolver2.doResolve(
                target,
                obj,
                `using description file: ${result.path} (relative path: ${relativePath})`,
                resolveContext,
                (err2, result2) => {
                  if (err2) return callback(err2);
                  if (result2 === void 0) return callback(null, null);
                  callback(null, result2);
                }
              );
            }
          );
        }
      );
    }
  }, __name(_a2, "DescriptionFilePlugin"), _a2);
  return DescriptionFilePlugin_1;
}
__name(requireDescriptionFilePlugin, "requireDescriptionFilePlugin");
var DirectoryExistsPlugin_1;
var hasRequiredDirectoryExistsPlugin;
function requireDirectoryExistsPlugin() {
  var _a2;
  if (hasRequiredDirectoryExistsPlugin) return DirectoryExistsPlugin_1;
  hasRequiredDirectoryExistsPlugin = 1;
  DirectoryExistsPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, target) {
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync(
        "DirectoryExistsPlugin",
        (request, resolveContext, callback) => {
          const fs = resolver2.fileSystem;
          const directory = request.path;
          if (!directory) return callback();
          fs.stat(directory, (err, stat) => {
            if (err || !stat) {
              if (resolveContext.missingDependencies) {
                resolveContext.missingDependencies.add(directory);
              }
              if (resolveContext.log) {
                resolveContext.log(`${directory} doesn't exist`);
              }
              return callback();
            }
            if (!stat.isDirectory()) {
              if (resolveContext.missingDependencies) {
                resolveContext.missingDependencies.add(directory);
              }
              if (resolveContext.log) {
                resolveContext.log(`${directory} is not a directory`);
              }
              return callback();
            }
            if (resolveContext.fileDependencies) {
              resolveContext.fileDependencies.add(directory);
            }
            resolver2.doResolve(
              target,
              request,
              `existing directory ${directory}`,
              resolveContext,
              callback
            );
          });
        }
      );
    }
  }, __name(_a2, "DirectoryExistsPlugin"), _a2);
  return DirectoryExistsPlugin_1;
}
__name(requireDirectoryExistsPlugin, "requireDirectoryExistsPlugin");
var entrypoints = {};
var identifier = {};
var hasRequiredIdentifier;
function requireIdentifier() {
  if (hasRequiredIdentifier) return identifier;
  hasRequiredIdentifier = 1;
  const PATH_QUERY_FRAGMENT_REGEXP = /^(#?(?:\0.|[^?#\0])*)(\?(?:\0.|[^#\0])*)?(#.*)?$/;
  const ZERO_ESCAPE_REGEXP = /\0(.)/g;
  function parseIdentifier(identifier2) {
    if (!identifier2) {
      return null;
    }
    const firstEscape = identifier2.indexOf("\0");
    if (firstEscape < 0) {
      const queryStart = identifier2.indexOf("?");
      const fragmentStart = identifier2.indexOf("#", 1);
      if (fragmentStart < 0) {
        if (queryStart < 0) {
          return [identifier2, "", ""];
        }
        return [
          identifier2.slice(0, queryStart),
          identifier2.slice(queryStart),
          ""
        ];
      }
      if (queryStart < 0 || fragmentStart < queryStart) {
        return [
          identifier2.slice(0, fragmentStart),
          "",
          identifier2.slice(fragmentStart)
        ];
      }
      return [
        identifier2.slice(0, queryStart),
        identifier2.slice(queryStart, fragmentStart),
        identifier2.slice(fragmentStart)
      ];
    }
    const match = PATH_QUERY_FRAGMENT_REGEXP.exec(identifier2);
    if (!match) return null;
    return [
      match[1].replace(ZERO_ESCAPE_REGEXP, "$1"),
      match[2] ? match[2].replace(ZERO_ESCAPE_REGEXP, "$1") : "",
      match[3] || ""
    ];
  }
  __name(parseIdentifier, "parseIdentifier");
  identifier.parseIdentifier = parseIdentifier;
  return identifier;
}
__name(requireIdentifier, "requireIdentifier");
var hasRequiredEntrypoints;
function requireEntrypoints() {
  if (hasRequiredEntrypoints) return entrypoints;
  hasRequiredEntrypoints = 1;
  const { parseIdentifier } = requireIdentifier();
  const slashCode = "/".charCodeAt(0);
  const dotCode = ".".charCodeAt(0);
  const hashCode = "#".charCodeAt(0);
  const patternRegEx = /\*/g;
  function patternKeyCompare(a2, b) {
    const aPatternIndex = a2.indexOf("*");
    const bPatternIndex = b.indexOf("*");
    const baseLenA = aPatternIndex === -1 ? a2.length : aPatternIndex + 1;
    const baseLenB = bPatternIndex === -1 ? b.length : bPatternIndex + 1;
    if (baseLenA > baseLenB) return -1;
    if (baseLenB > baseLenA) return 1;
    if (aPatternIndex === -1) return 1;
    if (bPatternIndex === -1) return -1;
    if (a2.length > b.length) return -1;
    if (b.length > a2.length) return 1;
    return 0;
  }
  __name(patternKeyCompare, "patternKeyCompare");
  function findMatch(request, field) {
    if (Object.prototype.hasOwnProperty.call(field, request) && !request.includes("*") && !request.endsWith("/")) {
      const target2 = (
        /** @type {{[k: string]: MappingValue}} */
        field[request]
      );
      return [target2, "", false, false, request];
    }
    let bestMatch = "";
    let bestMatchSubpath;
    const keys = Object.getOwnPropertyNames(field);
    for (let i2 = 0; i2 < keys.length; i2++) {
      const key = keys[i2];
      const patternIndex = key.indexOf("*");
      if (patternIndex !== -1 && request.startsWith(key.slice(0, patternIndex))) {
        const patternTrailer = key.slice(patternIndex + 1);
        if (request.length >= key.length && request.endsWith(patternTrailer) && patternKeyCompare(bestMatch, key) === 1 && key.lastIndexOf("*") === patternIndex) {
          bestMatch = key;
          bestMatchSubpath = request.slice(
            patternIndex,
            request.length - patternTrailer.length
          );
        }
      } else if (key[key.length - 1] === "/" && request.startsWith(key) && patternKeyCompare(bestMatch, key) === 1) {
        bestMatch = key;
        bestMatchSubpath = request.slice(key.length);
      }
    }
    if (bestMatch === "") return null;
    const target = (
      /** @type {{[k: string]: MappingValue}} */
      field[bestMatch]
    );
    const isSubpathMapping = bestMatch.endsWith("/");
    const isPattern = bestMatch.includes("*");
    return [
      target,
      /** @type {string} */
      bestMatchSubpath,
      isSubpathMapping,
      isPattern,
      bestMatch
    ];
  }
  __name(findMatch, "findMatch");
  function isConditionalMapping(mapping) {
    return mapping !== null && typeof mapping === "object" && !Array.isArray(mapping);
  }
  __name(isConditionalMapping, "isConditionalMapping");
  function conditionalMapping(conditionalMapping_, conditionNames) {
    const lookup = [[conditionalMapping_, Object.keys(conditionalMapping_), 0]];
    loop: while (lookup.length > 0) {
      const [mapping, conditions, j] = lookup[lookup.length - 1];
      for (let i2 = j; i2 < conditions.length; i2++) {
        const condition = conditions[i2];
        if (condition === "default") {
          const innerMapping = mapping[condition];
          if (isConditionalMapping(innerMapping)) {
            const conditionalMapping2 = (
              /** @type {ConditionalMapping} */
              innerMapping
            );
            lookup[lookup.length - 1][2] = i2 + 1;
            lookup.push([conditionalMapping2, Object.keys(conditionalMapping2), 0]);
            continue loop;
          }
          return (
            /** @type {DirectMapping} */
            innerMapping
          );
        }
        if (conditionNames.has(condition)) {
          const innerMapping = mapping[condition];
          if (isConditionalMapping(innerMapping)) {
            const conditionalMapping2 = (
              /** @type {ConditionalMapping} */
              innerMapping
            );
            lookup[lookup.length - 1][2] = i2 + 1;
            lookup.push([conditionalMapping2, Object.keys(conditionalMapping2), 0]);
            continue loop;
          }
          return (
            /** @type {DirectMapping} */
            innerMapping
          );
        }
      }
      lookup.pop();
    }
    return null;
  }
  __name(conditionalMapping, "conditionalMapping");
  function targetMapping(remainingRequest, isPattern, isSubpathMapping, mappingTarget, assert) {
    if (remainingRequest === void 0) {
      assert(mappingTarget, false);
      return mappingTarget;
    }
    if (isSubpathMapping) {
      assert(mappingTarget, true);
      return mappingTarget + remainingRequest;
    }
    assert(mappingTarget, false);
    let result = mappingTarget;
    if (isPattern) {
      result = result.replace(
        patternRegEx,
        remainingRequest.replace(/\$/g, "$$")
      );
    }
    return result;
  }
  __name(targetMapping, "targetMapping");
  function directMapping(remainingRequest, isPattern, isSubpathMapping, mappingTarget, conditionNames, assert) {
    if (mappingTarget === null) return [];
    if (typeof mappingTarget === "string") {
      return [
        targetMapping(
          remainingRequest,
          isPattern,
          isSubpathMapping,
          mappingTarget,
          assert
        )
      ];
    }
    const targets = [];
    for (const exp of mappingTarget) {
      if (typeof exp === "string") {
        targets.push(
          targetMapping(
            remainingRequest,
            isPattern,
            isSubpathMapping,
            exp,
            assert
          )
        );
        continue;
      }
      const mapping = conditionalMapping(exp, conditionNames);
      if (!mapping) continue;
      const innerExports = directMapping(
        remainingRequest,
        isPattern,
        isSubpathMapping,
        mapping,
        conditionNames,
        assert
      );
      for (const innerExport of innerExports) {
        targets.push(innerExport);
      }
    }
    return targets;
  }
  __name(directMapping, "directMapping");
  function createFieldProcessor(field, normalizeRequest, assertRequest, assertTarget) {
    return /* @__PURE__ */ __name(function fieldProcessor(request, conditionNames) {
      request = assertRequest(request);
      const match = findMatch(normalizeRequest(request), field);
      if (match === null) return [[], null];
      const [mapping, remainingRequest, isSubpathMapping, isPattern, usedField] = match;
      let direct = null;
      if (isConditionalMapping(mapping)) {
        direct = conditionalMapping(
          /** @type {ConditionalMapping} */
          mapping,
          conditionNames
        );
        if (direct === null) return [[], null];
      } else {
        direct = /** @type {DirectMapping} */
        mapping;
      }
      return [
        directMapping(
          remainingRequest,
          isPattern,
          isSubpathMapping,
          direct,
          conditionNames,
          assertTarget
        ),
        usedField
      ];
    }, "fieldProcessor");
  }
  __name(createFieldProcessor, "createFieldProcessor");
  function assertExportsFieldRequest(request) {
    if (request.charCodeAt(0) !== dotCode) {
      throw new Error('Request should be relative path and start with "."');
    }
    if (request.length === 1) return "";
    if (request.charCodeAt(1) !== slashCode) {
      throw new Error('Request should be relative path and start with "./"');
    }
    if (request.charCodeAt(request.length - 1) === slashCode) {
      throw new Error("Only requesting file allowed");
    }
    return request.slice(2);
  }
  __name(assertExportsFieldRequest, "assertExportsFieldRequest");
  function buildExportsField(field) {
    if (typeof field === "string" || Array.isArray(field)) {
      return { ".": field };
    }
    const keys = Object.keys(field);
    for (let i2 = 0; i2 < keys.length; i2++) {
      const key = keys[i2];
      if (key.charCodeAt(0) !== dotCode) {
        if (i2 === 0) {
          while (i2 < keys.length) {
            const charCode = keys[i2].charCodeAt(0);
            if (charCode === dotCode || charCode === slashCode) {
              throw new Error(
                `Exports field key should be relative path and start with "." (key: ${JSON.stringify(
                  key
                )})`
              );
            }
            i2++;
          }
          return { ".": field };
        }
        throw new Error(
          `Exports field key should be relative path and start with "." (key: ${JSON.stringify(
            key
          )})`
        );
      }
      if (key.length === 1) {
        continue;
      }
      if (key.charCodeAt(1) !== slashCode) {
        throw new Error(
          `Exports field key should be relative path and start with "./" (key: ${JSON.stringify(
            key
          )})`
        );
      }
    }
    return field;
  }
  __name(buildExportsField, "buildExportsField");
  function assertExportTarget(exp, expectFolder) {
    const parsedIdentifier = parseIdentifier(exp);
    if (!parsedIdentifier) {
      return;
    }
    const [relativePath] = parsedIdentifier;
    const isFolder = relativePath.charCodeAt(relativePath.length - 1) === slashCode;
    if (isFolder !== expectFolder) {
      throw new Error(
        expectFolder ? `Expecting folder to folder mapping. ${JSON.stringify(
          exp
        )} should end with "/"` : `Expecting file to file mapping. ${JSON.stringify(
          exp
        )} should not end with "/"`
      );
    }
  }
  __name(assertExportTarget, "assertExportTarget");
  entrypoints.processExportsField = /* @__PURE__ */ __name(function processExportsField(exportsField) {
    return createFieldProcessor(
      buildExportsField(exportsField),
      (request) => request.length === 0 ? "." : `./${request}`,
      assertExportsFieldRequest,
      assertExportTarget
    );
  }, "processExportsField");
  function assertImportsFieldRequest(request) {
    if (request.charCodeAt(0) !== hashCode) {
      throw new Error('Request should start with "#"');
    }
    if (request.length === 1) {
      throw new Error("Request should have at least 2 characters");
    }
    if (request.charCodeAt(1) === slashCode) {
      throw new Error('Request should not start with "#/"');
    }
    if (request.charCodeAt(request.length - 1) === slashCode) {
      throw new Error("Only requesting file allowed");
    }
    return request.slice(1);
  }
  __name(assertImportsFieldRequest, "assertImportsFieldRequest");
  function assertImportTarget(imp, expectFolder) {
    const parsedIdentifier = parseIdentifier(imp);
    if (!parsedIdentifier) {
      return;
    }
    const [relativePath] = parsedIdentifier;
    const isFolder = relativePath.charCodeAt(relativePath.length - 1) === slashCode;
    if (isFolder !== expectFolder) {
      throw new Error(
        expectFolder ? `Expecting folder to folder mapping. ${JSON.stringify(
          imp
        )} should end with "/"` : `Expecting file to file mapping. ${JSON.stringify(
          imp
        )} should not end with "/"`
      );
    }
  }
  __name(assertImportTarget, "assertImportTarget");
  entrypoints.processImportsField = /* @__PURE__ */ __name(function processImportsField(importsField) {
    return createFieldProcessor(
      importsField,
      (request) => `#${request}`,
      assertImportsFieldRequest,
      assertImportTarget
    );
  }, "processImportsField");
  return entrypoints;
}
__name(requireEntrypoints, "requireEntrypoints");
var ExportsFieldPlugin_1;
var hasRequiredExportsFieldPlugin;
function requireExportsFieldPlugin() {
  var _a2;
  if (hasRequiredExportsFieldPlugin) return ExportsFieldPlugin_1;
  hasRequiredExportsFieldPlugin = 1;
  const DescriptionFileUtils2 = requireDescriptionFileUtils();
  const forEachBail2 = requireForEachBail();
  const { processExportsField } = requireEntrypoints();
  const { parseIdentifier } = requireIdentifier();
  const {
    deprecatedInvalidSegmentRegEx,
    invalidSegmentRegEx
  } = requirePath();
  ExportsFieldPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {Set<string>} conditionNames condition names
     * @param {string | string[]} fieldNamePath name path
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, conditionNames, fieldNamePath, target) {
      this.source = source;
      this.target = target;
      this.conditionNames = conditionNames;
      this.fieldName = fieldNamePath;
      this.fieldProcessorCache = /* @__PURE__ */ new WeakMap();
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("ExportsFieldPlugin", (request, resolveContext, callback) => {
        if (!request.descriptionFilePath) return callback();
        if (
          // When the description file is inherited from parent, abort
          // (There is no description file inside of this package)
          request.relativePath !== "." || request.request === void 0
        ) {
          return callback();
        }
        const remainingRequest = request.query || request.fragment ? (request.request === "." ? "./" : request.request) + request.query + request.fragment : request.request;
        const exportsField = (
          /** @type {ExportsField|null|undefined} */
          DescriptionFileUtils2.getField(
            /** @type {JsonObject} */
            request.descriptionFileData,
            this.fieldName
          )
        );
        if (!exportsField) return callback();
        if (request.directory) {
          return callback(
            new Error(
              `Resolving to directories is not possible with the exports field (request was ${remainingRequest}/)`
            )
          );
        }
        let paths;
        let usedField;
        try {
          let fieldProcessor = this.fieldProcessorCache.get(
            /** @type {JsonObject} */
            request.descriptionFileData
          );
          if (fieldProcessor === void 0) {
            fieldProcessor = processExportsField(exportsField);
            this.fieldProcessorCache.set(
              /** @type {JsonObject} */
              request.descriptionFileData,
              fieldProcessor
            );
          }
          [paths, usedField] = fieldProcessor(
            remainingRequest,
            this.conditionNames
          );
        } catch (err) {
          if (resolveContext.log) {
            resolveContext.log(
              `Exports field in ${request.descriptionFilePath} can't be processed: ${err}`
            );
          }
          return callback(
            /** @type {Error} */
            err
          );
        }
        if (paths.length === 0) {
          return callback(
            new Error(
              `Package path ${remainingRequest} is not exported from package ${request.descriptionFileRoot} (see exports field in ${request.descriptionFilePath})`
            )
          );
        }
        forEachBail2(
          paths,
          /**
           * @param {string} path path
           * @param {(err?: null|Error, result?: null|ResolveRequest) => void} callback callback
           * @param {number} i index
           * @returns {void}
           */
          (path2, callback2, i2) => {
            const parsedIdentifier = parseIdentifier(path2);
            if (!parsedIdentifier) return callback2();
            const [relativePath, query, fragment] = parsedIdentifier;
            if (relativePath.length === 0 || !relativePath.startsWith("./")) {
              if (paths.length === i2) {
                return callback2(
                  new Error(
                    `Invalid "exports" target "${path2}" defined for "${usedField}" in the package config ${request.descriptionFilePath}, targets must start with "./"`
                  )
                );
              }
              return callback2();
            }
            if (invalidSegmentRegEx.exec(relativePath.slice(2)) !== null && deprecatedInvalidSegmentRegEx.test(relativePath.slice(2)) !== null) {
              if (paths.length === i2) {
                return callback2(
                  new Error(
                    `Invalid "exports" target "${path2}" defined for "${usedField}" in the package config ${request.descriptionFilePath}, targets must start with "./"`
                  )
                );
              }
              return callback2();
            }
            const obj = {
              ...request,
              request: void 0,
              path: resolver2.join(
                /** @type {string} */
                request.descriptionFileRoot,
                relativePath
              ),
              relativePath,
              query,
              fragment
            };
            resolver2.doResolve(
              target,
              obj,
              `using exports field: ${path2}`,
              resolveContext,
              (err, result) => {
                if (err) return callback2(err);
                if (result === void 0) return callback2(null, null);
                callback2(null, result);
              }
            );
          },
          /**
           * @param {(null | Error)=} err error
           * @param {(null | ResolveRequest)=} result result
           * @returns {void}
           */
          (err, result) => callback(err, result || null)
        );
      });
    }
  }, __name(_a2, "ExportsFieldPlugin"), _a2);
  return ExportsFieldPlugin_1;
}
__name(requireExportsFieldPlugin, "requireExportsFieldPlugin");
var ExtensionAliasPlugin_1;
var hasRequiredExtensionAliasPlugin;
function requireExtensionAliasPlugin() {
  var _a2;
  if (hasRequiredExtensionAliasPlugin) return ExtensionAliasPlugin_1;
  hasRequiredExtensionAliasPlugin = 1;
  const forEachBail2 = requireForEachBail();
  ExtensionAliasPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {ExtensionAliasOption} options options
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, options, target) {
      this.source = source;
      this.options = options;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      const { extension, alias } = this.options;
      resolver2.getHook(this.source).tapAsync("ExtensionAliasPlugin", (request, resolveContext, callback) => {
        const requestPath = request.request;
        if (!requestPath || !requestPath.endsWith(extension)) return callback();
        const isAliasString = typeof alias === "string";
        const resolve2 = /* @__PURE__ */ __name((alias2, callback2, index) => {
          const newRequest = `${requestPath.slice(
            0,
            -extension.length
          )}${alias2}`;
          return resolver2.doResolve(
            target,
            {
              ...request,
              request: newRequest,
              fullySpecified: true
            },
            `aliased from extension alias with mapping '${extension}' to '${alias2}'`,
            resolveContext,
            (err, result) => {
              if (!isAliasString && index) {
                if (index !== this.options.alias.length) {
                  if (resolveContext.log) {
                    resolveContext.log(
                      `Failed to alias from extension alias with mapping '${extension}' to '${alias2}' for '${newRequest}': ${err}`
                    );
                  }
                  return callback2(null, result);
                }
                return callback2(err, result);
              }
              callback2(err, result);
            }
          );
        }, "resolve");
        const stoppingCallback = /* @__PURE__ */ __name((err, result) => {
          if (err) return callback(err);
          if (result) return callback(null, result);
          return callback(null, null);
        }, "stoppingCallback");
        if (isAliasString) {
          resolve2(alias, stoppingCallback);
        } else if (alias.length > 1) {
          forEachBail2(alias, resolve2, stoppingCallback);
        } else {
          resolve2(alias[0], stoppingCallback);
        }
      });
    }
  }, __name(_a2, "ExtensionAliasPlugin"), _a2);
  return ExtensionAliasPlugin_1;
}
__name(requireExtensionAliasPlugin, "requireExtensionAliasPlugin");
var FileExistsPlugin_1;
var hasRequiredFileExistsPlugin;
function requireFileExistsPlugin() {
  var _a2;
  if (hasRequiredFileExistsPlugin) return FileExistsPlugin_1;
  hasRequiredFileExistsPlugin = 1;
  FileExistsPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, target) {
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      const fs = resolver2.fileSystem;
      resolver2.getHook(this.source).tapAsync("FileExistsPlugin", (request, resolveContext, callback) => {
        const file = request.path;
        if (!file) return callback();
        fs.stat(file, (err, stat) => {
          if (err || !stat) {
            if (resolveContext.missingDependencies) {
              resolveContext.missingDependencies.add(file);
            }
            if (resolveContext.log) resolveContext.log(`${file} doesn't exist`);
            return callback();
          }
          if (!stat.isFile()) {
            if (resolveContext.missingDependencies) {
              resolveContext.missingDependencies.add(file);
            }
            if (resolveContext.log) resolveContext.log(`${file} is not a file`);
            return callback();
          }
          if (resolveContext.fileDependencies) {
            resolveContext.fileDependencies.add(file);
          }
          resolver2.doResolve(
            target,
            request,
            `existing file: ${file}`,
            resolveContext,
            callback
          );
        });
      });
    }
  }, __name(_a2, "FileExistsPlugin"), _a2);
  return FileExistsPlugin_1;
}
__name(requireFileExistsPlugin, "requireFileExistsPlugin");
var ImportsFieldPlugin_1;
var hasRequiredImportsFieldPlugin;
function requireImportsFieldPlugin() {
  var _a2;
  if (hasRequiredImportsFieldPlugin) return ImportsFieldPlugin_1;
  hasRequiredImportsFieldPlugin = 1;
  const DescriptionFileUtils2 = requireDescriptionFileUtils();
  const forEachBail2 = requireForEachBail();
  const { processImportsField } = requireEntrypoints();
  const { parseIdentifier } = requireIdentifier();
  const {
    deprecatedInvalidSegmentRegEx,
    invalidSegmentRegEx
  } = requirePath();
  const dotCode = ".".charCodeAt(0);
  ImportsFieldPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {Set<string>} conditionNames condition names
     * @param {string | string[]} fieldNamePath name path
     * @param {string | ResolveStepHook} targetFile target file
     * @param {string | ResolveStepHook} targetPackage target package
     */
    constructor(source, conditionNames, fieldNamePath, targetFile, targetPackage) {
      this.source = source;
      this.targetFile = targetFile;
      this.targetPackage = targetPackage;
      this.conditionNames = conditionNames;
      this.fieldName = fieldNamePath;
      this.fieldProcessorCache = /* @__PURE__ */ new WeakMap();
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const targetFile = resolver2.ensureHook(this.targetFile);
      const targetPackage = resolver2.ensureHook(this.targetPackage);
      resolver2.getHook(this.source).tapAsync("ImportsFieldPlugin", (request, resolveContext, callback) => {
        if (!request.descriptionFilePath || request.request === void 0) {
          return callback();
        }
        const remainingRequest = request.request + request.query + request.fragment;
        const importsField = (
          /** @type {ImportsField|null|undefined} */
          DescriptionFileUtils2.getField(
            /** @type {JsonObject} */
            request.descriptionFileData,
            this.fieldName
          )
        );
        if (!importsField) return callback();
        if (request.directory) {
          return callback(
            new Error(
              `Resolving to directories is not possible with the imports field (request was ${remainingRequest}/)`
            )
          );
        }
        let paths;
        let usedField;
        try {
          let fieldProcessor = this.fieldProcessorCache.get(
            /** @type {JsonObject} */
            request.descriptionFileData
          );
          if (fieldProcessor === void 0) {
            fieldProcessor = processImportsField(importsField);
            this.fieldProcessorCache.set(
              /** @type {JsonObject} */
              request.descriptionFileData,
              fieldProcessor
            );
          }
          [paths, usedField] = fieldProcessor(
            remainingRequest,
            this.conditionNames
          );
        } catch (err) {
          if (resolveContext.log) {
            resolveContext.log(
              `Imports field in ${request.descriptionFilePath} can't be processed: ${err}`
            );
          }
          return callback(
            /** @type {Error} */
            err
          );
        }
        if (paths.length === 0) {
          return callback(
            new Error(
              `Package import ${remainingRequest} is not imported from package ${request.descriptionFileRoot} (see imports field in ${request.descriptionFilePath})`
            )
          );
        }
        forEachBail2(
          paths,
          /**
           * @param {string} path path
           * @param {(err?: null|Error, result?: null|ResolveRequest) => void} callback callback
           * @param {number} i index
           * @returns {void}
           */
          (path2, callback2, i2) => {
            const parsedIdentifier = parseIdentifier(path2);
            if (!parsedIdentifier) return callback2();
            const [path_, query, fragment] = parsedIdentifier;
            switch (path_.charCodeAt(0)) {
              case dotCode: {
                if (invalidSegmentRegEx.exec(path_.slice(2)) !== null && deprecatedInvalidSegmentRegEx.test(path_.slice(2)) !== null) {
                  if (paths.length === i2) {
                    return callback2(
                      new Error(
                        `Invalid "imports" target "${path2}" defined for "${usedField}" in the package config ${request.descriptionFilePath}, targets must start with "./"`
                      )
                    );
                  }
                  return callback2();
                }
                const obj = {
                  ...request,
                  request: void 0,
                  path: resolver2.join(
                    /** @type {string} */
                    request.descriptionFileRoot,
                    path_
                  ),
                  relativePath: path_,
                  query,
                  fragment
                };
                resolver2.doResolve(
                  targetFile,
                  obj,
                  `using imports field: ${path2}`,
                  resolveContext,
                  (err, result) => {
                    if (err) return callback2(err);
                    if (result === void 0) return callback2(null, null);
                    callback2(null, result);
                  }
                );
                break;
              }
              default: {
                const obj = {
                  ...request,
                  request: path_,
                  relativePath: path_,
                  fullySpecified: true,
                  query,
                  fragment
                };
                resolver2.doResolve(
                  targetPackage,
                  obj,
                  `using imports field: ${path2}`,
                  resolveContext,
                  (err, result) => {
                    if (err) return callback2(err);
                    if (result === void 0) return callback2(null, null);
                    callback2(null, result);
                  }
                );
              }
            }
          },
          /**
           * @param {(null|Error)=} err error
           * @param {(null|ResolveRequest)=} result result
           * @returns {void}
           */
          (err, result) => callback(err, result || null)
        );
      });
    }
  }, __name(_a2, "ImportsFieldPlugin"), _a2);
  return ImportsFieldPlugin_1;
}
__name(requireImportsFieldPlugin, "requireImportsFieldPlugin");
var JoinRequestPartPlugin_1;
var hasRequiredJoinRequestPartPlugin;
function requireJoinRequestPartPlugin() {
  var _a2;
  if (hasRequiredJoinRequestPartPlugin) return JoinRequestPartPlugin_1;
  hasRequiredJoinRequestPartPlugin = 1;
  const namespaceStartCharCode = "@".charCodeAt(0);
  JoinRequestPartPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, target) {
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync(
        "JoinRequestPartPlugin",
        (request, resolveContext, callback) => {
          const req = request.request || "";
          let i2 = req.indexOf("/", 3);
          if (i2 >= 0 && req.charCodeAt(2) === namespaceStartCharCode) {
            i2 = req.indexOf("/", i2 + 1);
          }
          let moduleName;
          let remainingRequest;
          let fullySpecified;
          if (i2 < 0) {
            moduleName = req;
            remainingRequest = ".";
            fullySpecified = false;
          } else {
            moduleName = req.slice(0, i2);
            remainingRequest = `.${req.slice(i2)}`;
            fullySpecified = /** @type {boolean} */
            request.fullySpecified;
          }
          const obj = {
            ...request,
            path: resolver2.join(
              /** @type {string} */
              request.path,
              moduleName
            ),
            relativePath: request.relativePath && resolver2.join(request.relativePath, moduleName),
            request: remainingRequest,
            fullySpecified
          };
          resolver2.doResolve(target, obj, null, resolveContext, callback);
        }
      );
    }
  }, __name(_a2, "JoinRequestPartPlugin"), _a2);
  return JoinRequestPartPlugin_1;
}
__name(requireJoinRequestPartPlugin, "requireJoinRequestPartPlugin");
var JoinRequestPlugin_1;
var hasRequiredJoinRequestPlugin;
function requireJoinRequestPlugin() {
  var _a2;
  if (hasRequiredJoinRequestPlugin) return JoinRequestPlugin_1;
  hasRequiredJoinRequestPlugin = 1;
  JoinRequestPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, target) {
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("JoinRequestPlugin", (request, resolveContext, callback) => {
        const requestPath = (
          /** @type {string} */
          request.path
        );
        const requestRequest = (
          /** @type {string} */
          request.request
        );
        const obj = {
          ...request,
          path: resolver2.join(requestPath, requestRequest),
          relativePath: request.relativePath && resolver2.join(request.relativePath, requestRequest),
          request: void 0
        };
        resolver2.doResolve(target, obj, null, resolveContext, callback);
      });
    }
  }, __name(_a2, "JoinRequestPlugin"), _a2);
  return JoinRequestPlugin_1;
}
__name(requireJoinRequestPlugin, "requireJoinRequestPlugin");
var MainFieldPlugin_1;
var hasRequiredMainFieldPlugin;
function requireMainFieldPlugin() {
  var _a2;
  if (hasRequiredMainFieldPlugin) return MainFieldPlugin_1;
  hasRequiredMainFieldPlugin = 1;
  const path2 = path9__default;
  const DescriptionFileUtils2 = requireDescriptionFileUtils();
  const alreadyTriedMainField = Symbol("alreadyTriedMainField");
  MainFieldPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {MainFieldOptions} options options
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, options, target) {
      this.source = source;
      this.options = options;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("MainFieldPlugin", (request, resolveContext, callback) => {
        if (request.path !== request.descriptionFileRoot || /** @type {ResolveRequest & { [alreadyTriedMainField]?: string }} */
        request[alreadyTriedMainField] === request.descriptionFilePath || !request.descriptionFilePath) {
          return callback();
        }
        const filename = path2.basename(request.descriptionFilePath);
        let mainModule = (
          /** @type {string|null|undefined} */
          DescriptionFileUtils2.getField(
            /** @type {JsonObject} */
            request.descriptionFileData,
            this.options.name
          )
        );
        if (!mainModule || typeof mainModule !== "string" || mainModule === "." || mainModule === "./") {
          return callback();
        }
        if (this.options.forceRelative && !/^\.\.?\//.test(mainModule)) {
          mainModule = `./${mainModule}`;
        }
        const obj = {
          ...request,
          request: mainModule,
          module: false,
          directory: mainModule.endsWith("/"),
          [alreadyTriedMainField]: request.descriptionFilePath
        };
        return resolver2.doResolve(
          target,
          obj,
          `use ${mainModule} from ${this.options.name} in ${filename}`,
          resolveContext,
          callback
        );
      });
    }
  }, __name(_a2, "MainFieldPlugin"), _a2);
  return MainFieldPlugin_1;
}
__name(requireMainFieldPlugin, "requireMainFieldPlugin");
var getPaths = { exports: {} };
var hasRequiredGetPaths;
function requireGetPaths() {
  if (hasRequiredGetPaths) return getPaths.exports;
  hasRequiredGetPaths = 1;
  getPaths.exports = /* @__PURE__ */ __name(function getPaths2(path2) {
    if (path2 === "/") return { paths: ["/"], segments: [""] };
    const parts = path2.split(/(.*?[\\/]+)/);
    const paths = [path2];
    const segments = [parts[parts.length - 1]];
    let part = parts[parts.length - 1];
    path2 = path2.slice(0, Math.max(0, path2.length - part.length - 1));
    for (let i2 = parts.length - 2; i2 > 2; i2 -= 2) {
      paths.push(path2);
      part = parts[i2];
      path2 = path2.slice(0, Math.max(0, path2.length - part.length)) || "/";
      segments.push(part.slice(0, -1));
    }
    [, part] = parts;
    segments.push(part);
    paths.push(part);
    return {
      paths,
      segments
    };
  }, "getPaths");
  getPaths.exports.basename = /* @__PURE__ */ __name(function basename(path2) {
    const i2 = path2.lastIndexOf("/");
    const j = path2.lastIndexOf("\\");
    const resolvedPath = i2 < 0 ? j : j < 0 ? i2 : i2 < j ? j : i2;
    if (resolvedPath < 0) return null;
    const basename2 = path2.slice(resolvedPath + 1);
    return basename2;
  }, "basename");
  return getPaths.exports;
}
__name(requireGetPaths, "requireGetPaths");
var ModulesInHierarchicalDirectoriesPlugin_1;
var hasRequiredModulesInHierarchicalDirectoriesPlugin;
function requireModulesInHierarchicalDirectoriesPlugin() {
  var _a2;
  if (hasRequiredModulesInHierarchicalDirectoriesPlugin) return ModulesInHierarchicalDirectoriesPlugin_1;
  hasRequiredModulesInHierarchicalDirectoriesPlugin = 1;
  const forEachBail2 = requireForEachBail();
  const getPaths2 = requireGetPaths();
  ModulesInHierarchicalDirectoriesPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | Array<string>} directories directories
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, directories, target) {
      this.source = source;
      this.directories = /** @type {Array<string>} */
      [...directories];
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync(
        "ModulesInHierarchicalDirectoriesPlugin",
        (request, resolveContext, callback) => {
          const fs = resolver2.fileSystem;
          const addrs = getPaths2(
            /** @type {string} */
            request.path
          ).paths.map(
            (path2) => this.directories.map(
              (directory) => resolver2.join(path2, directory)
            )
          ).reduce((array, path2) => {
            array.push(...path2);
            return array;
          }, []);
          forEachBail2(
            addrs,
            /**
             * @param {string} addr addr
             * @param {(err?: null|Error, result?: null|ResolveRequest) => void} callback callback
             * @returns {void}
             */
            (addr, callback2) => {
              fs.stat(addr, (err, stat) => {
                if (!err && stat && stat.isDirectory()) {
                  const obj = {
                    ...request,
                    path: addr,
                    request: `./${request.request}`,
                    module: false
                  };
                  const message = `looking for modules in ${addr}`;
                  return resolver2.doResolve(
                    target,
                    obj,
                    message,
                    resolveContext,
                    callback2
                  );
                }
                if (resolveContext.log) {
                  resolveContext.log(
                    `${addr} doesn't exist or is not a directory`
                  );
                }
                if (resolveContext.missingDependencies) {
                  resolveContext.missingDependencies.add(addr);
                }
                return callback2();
              });
            },
            callback
          );
        }
      );
    }
  }, __name(_a2, "ModulesInHierarchicalDirectoriesPlugin"), _a2);
  return ModulesInHierarchicalDirectoriesPlugin_1;
}
__name(requireModulesInHierarchicalDirectoriesPlugin, "requireModulesInHierarchicalDirectoriesPlugin");
var ModulesInRootPlugin_1;
var hasRequiredModulesInRootPlugin;
function requireModulesInRootPlugin() {
  var _a2;
  if (hasRequiredModulesInRootPlugin) return ModulesInRootPlugin_1;
  hasRequiredModulesInRootPlugin = 1;
  ModulesInRootPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string} path path
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, path2, target) {
      this.source = source;
      this.path = path2;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("ModulesInRootPlugin", (request, resolveContext, callback) => {
        const obj = {
          ...request,
          path: this.path,
          request: `./${request.request}`,
          module: false
        };
        resolver2.doResolve(
          target,
          obj,
          `looking for modules in ${this.path}`,
          resolveContext,
          callback
        );
      });
    }
  }, __name(_a2, "ModulesInRootPlugin"), _a2);
  return ModulesInRootPlugin_1;
}
__name(requireModulesInRootPlugin, "requireModulesInRootPlugin");
var NextPlugin_1;
var hasRequiredNextPlugin;
function requireNextPlugin() {
  var _a2;
  if (hasRequiredNextPlugin) return NextPlugin_1;
  hasRequiredNextPlugin = 1;
  NextPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, target) {
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("NextPlugin", (request, resolveContext, callback) => {
        resolver2.doResolve(target, request, null, resolveContext, callback);
      });
    }
  }, __name(_a2, "NextPlugin"), _a2);
  return NextPlugin_1;
}
__name(requireNextPlugin, "requireNextPlugin");
var ParsePlugin_1;
var hasRequiredParsePlugin;
function requireParsePlugin() {
  var _a2;
  if (hasRequiredParsePlugin) return ParsePlugin_1;
  hasRequiredParsePlugin = 1;
  ParsePlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {Partial<ResolveRequest>} requestOptions request options
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, requestOptions, target) {
      this.source = source;
      this.requestOptions = requestOptions;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("ParsePlugin", (request, resolveContext, callback) => {
        const parsed = resolver2.parse(
          /** @type {string} */
          request.request
        );
        const obj = { ...request, ...parsed, ...this.requestOptions };
        if (request.query && !parsed.query) {
          obj.query = request.query;
        }
        if (request.fragment && !parsed.fragment) {
          obj.fragment = request.fragment;
        }
        if (parsed && resolveContext.log) {
          if (parsed.module) resolveContext.log("Parsed request is a module");
          if (parsed.directory) {
            resolveContext.log("Parsed request is a directory");
          }
        }
        if (obj.request && !obj.query && obj.fragment) {
          const directory = obj.fragment.endsWith("/");
          const alternative = {
            ...obj,
            directory,
            request: obj.request + (obj.directory ? "/" : "") + (directory ? obj.fragment.slice(0, -1) : obj.fragment),
            fragment: ""
          };
          resolver2.doResolve(
            target,
            alternative,
            null,
            resolveContext,
            (err, result) => {
              if (err) return callback(err);
              if (result) return callback(null, result);
              resolver2.doResolve(target, obj, null, resolveContext, callback);
            }
          );
          return;
        }
        resolver2.doResolve(target, obj, null, resolveContext, callback);
      });
    }
  }, __name(_a2, "ParsePlugin"), _a2);
  return ParsePlugin_1;
}
__name(requireParsePlugin, "requireParsePlugin");
var PnpPlugin_1;
var hasRequiredPnpPlugin;
function requirePnpPlugin() {
  var _a2;
  if (hasRequiredPnpPlugin) return PnpPlugin_1;
  hasRequiredPnpPlugin = 1;
  PnpPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {PnpApiImpl} pnpApi pnpApi
     * @param {string | ResolveStepHook} target target
     * @param {string | ResolveStepHook} alternateTarget alternateTarget
     */
    constructor(source, pnpApi, target, alternateTarget) {
      this.source = source;
      this.pnpApi = pnpApi;
      this.target = target;
      this.alternateTarget = alternateTarget;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      const alternateTarget = resolver2.ensureHook(this.alternateTarget);
      resolver2.getHook(this.source).tapAsync("PnpPlugin", (request, resolveContext, callback) => {
        const req = request.request;
        if (!req) return callback();
        const issuer = `${request.path}/`;
        const packageMatch = /^(@[^/]+\/)?[^/]+/.exec(req);
        if (!packageMatch) return callback();
        const [packageName] = packageMatch;
        const innerRequest = `.${req.slice(packageName.length)}`;
        let resolution;
        let apiResolution;
        try {
          resolution = this.pnpApi.resolveToUnqualified(packageName, issuer, {
            considerBuiltins: false
          });
          if (resolution === null) {
            resolver2.doResolve(
              alternateTarget,
              request,
              "issuer is not managed by a pnpapi",
              resolveContext,
              (err, result) => {
                if (err) return callback(err);
                if (result) return callback(null, result);
                return callback(null, null);
              }
            );
            return;
          }
          if (resolveContext.fileDependencies) {
            apiResolution = this.pnpApi.resolveToUnqualified("pnpapi", issuer, {
              considerBuiltins: false
            });
          }
        } catch (error) {
          if (
            /** @type {Error & { code: string }} */
            error.code === "MODULE_NOT_FOUND" && /** @type {Error & { pnpCode: string }} */
            error.pnpCode === "UNDECLARED_DEPENDENCY"
          ) {
            if (resolveContext.log) {
              resolveContext.log("request is not managed by the pnpapi");
              for (
                const line of
                /** @type {Error} */
                error.message.split("\n").filter(Boolean)
              ) {
                resolveContext.log(`  ${line}`);
              }
            }
            return callback();
          }
          return callback(
            /** @type {Error} */
            error
          );
        }
        if (resolution === packageName) return callback();
        if (apiResolution && resolveContext.fileDependencies) {
          resolveContext.fileDependencies.add(apiResolution);
        }
        const obj = {
          ...request,
          path: resolution,
          request: innerRequest,
          ignoreSymlinks: true,
          fullySpecified: request.fullySpecified && innerRequest !== "."
        };
        resolver2.doResolve(
          target,
          obj,
          `resolved by pnp to ${resolution}`,
          resolveContext,
          (err, result) => {
            if (err) return callback(err);
            if (result) return callback(null, result);
            return callback(null, null);
          }
        );
      });
    }
  }, __name(_a2, "PnpPlugin"), _a2);
  return PnpPlugin_1;
}
__name(requirePnpPlugin, "requirePnpPlugin");
var lib$1 = {};
var Hook_1;
var hasRequiredHook;
function requireHook() {
  if (hasRequiredHook) return Hook_1;
  hasRequiredHook = 1;
  const util2 = require$$0$3;
  const deprecateContext = util2.deprecate(
    () => {
    },
    "Hook.context is deprecated and will be removed"
  );
  function CALL_DELEGATE(...args) {
    this.call = this._createCall("sync");
    return this.call(...args);
  }
  __name(CALL_DELEGATE, "CALL_DELEGATE");
  function CALL_ASYNC_DELEGATE(...args) {
    this.callAsync = this._createCall("async");
    return this.callAsync(...args);
  }
  __name(CALL_ASYNC_DELEGATE, "CALL_ASYNC_DELEGATE");
  function PROMISE_DELEGATE(...args) {
    this.promise = this._createCall("promise");
    return this.promise(...args);
  }
  __name(PROMISE_DELEGATE, "PROMISE_DELEGATE");
  const _Hook = class _Hook {
    constructor(args = [], name2 = void 0) {
      this._args = args;
      this.name = name2;
      this.taps = [];
      this.interceptors = [];
      this._call = CALL_DELEGATE;
      this.call = CALL_DELEGATE;
      this._callAsync = CALL_ASYNC_DELEGATE;
      this.callAsync = CALL_ASYNC_DELEGATE;
      this._promise = PROMISE_DELEGATE;
      this.promise = PROMISE_DELEGATE;
      this._x = void 0;
      this.compile = this.compile;
      this.tap = this.tap;
      this.tapAsync = this.tapAsync;
      this.tapPromise = this.tapPromise;
    }
    compile(_options) {
      throw new Error("Abstract: should be overridden");
    }
    _createCall(type) {
      return this.compile({
        taps: this.taps,
        interceptors: this.interceptors,
        args: this._args,
        type
      });
    }
    _tap(type, options, fn) {
      if (typeof options === "string") {
        options = {
          name: options.trim()
        };
      } else if (typeof options !== "object" || options === null) {
        throw new Error("Invalid tap options");
      }
      if (typeof options.name !== "string" || options.name === "") {
        throw new Error("Missing name for tap");
      }
      if (typeof options.context !== "undefined") {
        deprecateContext();
      }
      options = Object.assign({ type, fn }, options);
      options = this._runRegisterInterceptors(options);
      this._insert(options);
    }
    tap(options, fn) {
      this._tap("sync", options, fn);
    }
    tapAsync(options, fn) {
      this._tap("async", options, fn);
    }
    tapPromise(options, fn) {
      this._tap("promise", options, fn);
    }
    _runRegisterInterceptors(options) {
      for (const interceptor of this.interceptors) {
        if (interceptor.register) {
          const newOptions = interceptor.register(options);
          if (newOptions !== void 0) {
            options = newOptions;
          }
        }
      }
      return options;
    }
    withOptions(options) {
      const mergeOptions = /* @__PURE__ */ __name((opt) => Object.assign({}, options, typeof opt === "string" ? { name: opt } : opt), "mergeOptions");
      return {
        name: this.name,
        tap: /* @__PURE__ */ __name((opt, fn) => this.tap(mergeOptions(opt), fn), "tap"),
        tapAsync: /* @__PURE__ */ __name((opt, fn) => this.tapAsync(mergeOptions(opt), fn), "tapAsync"),
        tapPromise: /* @__PURE__ */ __name((opt, fn) => this.tapPromise(mergeOptions(opt), fn), "tapPromise"),
        intercept: /* @__PURE__ */ __name((interceptor) => this.intercept(interceptor), "intercept"),
        isUsed: /* @__PURE__ */ __name(() => this.isUsed(), "isUsed"),
        withOptions: /* @__PURE__ */ __name((opt) => this.withOptions(mergeOptions(opt)), "withOptions")
      };
    }
    isUsed() {
      return this.taps.length > 0 || this.interceptors.length > 0;
    }
    intercept(interceptor) {
      this._resetCompilation();
      this.interceptors.push(Object.assign({}, interceptor));
      if (interceptor.register) {
        for (let i2 = 0; i2 < this.taps.length; i2++) {
          this.taps[i2] = interceptor.register(this.taps[i2]);
        }
      }
    }
    _resetCompilation() {
      this.call = this._call;
      this.callAsync = this._callAsync;
      this.promise = this._promise;
    }
    _insert(item) {
      this._resetCompilation();
      let before;
      if (typeof item.before === "string") {
        before = /* @__PURE__ */ new Set([item.before]);
      } else if (Array.isArray(item.before)) {
        before = new Set(item.before);
      }
      let stage = 0;
      if (typeof item.stage === "number") {
        stage = item.stage;
      }
      let i2 = this.taps.length;
      while (i2 > 0) {
        i2--;
        const tap = this.taps[i2];
        this.taps[i2 + 1] = tap;
        const xStage = tap.stage || 0;
        if (before) {
          if (before.has(tap.name)) {
            before.delete(tap.name);
            continue;
          }
          if (before.size > 0) {
            continue;
          }
        }
        if (xStage > stage) {
          continue;
        }
        i2++;
        break;
      }
      this.taps[i2] = item;
    }
  };
  __name(_Hook, "Hook");
  let Hook = _Hook;
  Object.setPrototypeOf(Hook.prototype, null);
  Hook_1 = Hook;
  return Hook_1;
}
__name(requireHook, "requireHook");
var HookCodeFactory_1;
var hasRequiredHookCodeFactory;
function requireHookCodeFactory() {
  if (hasRequiredHookCodeFactory) return HookCodeFactory_1;
  hasRequiredHookCodeFactory = 1;
  const _HookCodeFactory = class _HookCodeFactory {
    constructor(config) {
      this.config = config;
      this.options = void 0;
      this._args = void 0;
    }
    create(options) {
      this.init(options);
      let fn;
      switch (this.options.type) {
        case "sync":
          fn = new Function(
            this.args(),
            `"use strict";
${this.header()}${this.contentWithInterceptors({
              onError: /* @__PURE__ */ __name((err) => `throw ${err};
`, "onError"),
              onResult: /* @__PURE__ */ __name((result) => `return ${result};
`, "onResult"),
              resultReturns: true,
              onDone: /* @__PURE__ */ __name(() => "", "onDone"),
              rethrowIfPossible: true
            })}`
          );
          break;
        case "async":
          fn = new Function(
            this.args({
              after: "_callback"
            }),
            `"use strict";
${this.header()}${this.contentWithInterceptors({
              onError: /* @__PURE__ */ __name((err) => `_callback(${err});
`, "onError"),
              onResult: /* @__PURE__ */ __name((result) => `_callback(null, ${result});
`, "onResult"),
              onDone: /* @__PURE__ */ __name(() => "_callback();\n", "onDone")
            })}`
          );
          break;
        case "promise": {
          let errorHelperUsed = false;
          const content = this.contentWithInterceptors({
            onError: /* @__PURE__ */ __name((err) => {
              errorHelperUsed = true;
              return `_error(${err});
`;
            }, "onError"),
            onResult: /* @__PURE__ */ __name((result) => `_resolve(${result});
`, "onResult"),
            onDone: /* @__PURE__ */ __name(() => "_resolve();\n", "onDone")
          });
          let code = "";
          code += '"use strict";\n';
          code += this.header();
          code += "return new Promise((function(_resolve, _reject) {\n";
          if (errorHelperUsed) {
            code += "var _sync = true;\n";
            code += "function _error(_err) {\n";
            code += "if(_sync)\n";
            code += "_resolve(Promise.resolve().then((function() { throw _err; })));\n";
            code += "else\n";
            code += "_reject(_err);\n";
            code += "};\n";
          }
          code += content;
          if (errorHelperUsed) {
            code += "_sync = false;\n";
          }
          code += "}));\n";
          fn = new Function(this.args(), code);
          break;
        }
      }
      this.deinit();
      return fn;
    }
    setup(instance, options) {
      instance._x = options.taps.map((t) => t.fn);
    }
    /**
     * @param {{ type: "sync" | "promise" | "async", taps: Array<Tap>, interceptors: Array<Interceptor> }} options
     */
    init(options) {
      this.options = options;
      this._args = [...options.args];
    }
    deinit() {
      this.options = void 0;
      this._args = void 0;
    }
    contentWithInterceptors(options) {
      if (this.options.interceptors.length > 0) {
        const { onError: onError2, onResult, onDone } = options;
        let code = "";
        for (let i2 = 0; i2 < this.options.interceptors.length; i2++) {
          const interceptor = this.options.interceptors[i2];
          if (interceptor.call) {
            code += `${this.getInterceptor(i2)}.call(${this.args({
              before: interceptor.context ? "_context" : void 0
            })});
`;
          }
        }
        code += this.content(
          Object.assign(options, {
            onError: onError2 && ((err) => {
              let code2 = "";
              for (let i2 = 0; i2 < this.options.interceptors.length; i2++) {
                const interceptor = this.options.interceptors[i2];
                if (interceptor.error) {
                  code2 += `${this.getInterceptor(i2)}.error(${err});
`;
                }
              }
              code2 += onError2(err);
              return code2;
            }),
            onResult: onResult && ((result) => {
              let code2 = "";
              for (let i2 = 0; i2 < this.options.interceptors.length; i2++) {
                const interceptor = this.options.interceptors[i2];
                if (interceptor.result) {
                  code2 += `${this.getInterceptor(i2)}.result(${result});
`;
                }
              }
              code2 += onResult(result);
              return code2;
            }),
            onDone: onDone && (() => {
              let code2 = "";
              for (let i2 = 0; i2 < this.options.interceptors.length; i2++) {
                const interceptor = this.options.interceptors[i2];
                if (interceptor.done) {
                  code2 += `${this.getInterceptor(i2)}.done();
`;
                }
              }
              code2 += onDone();
              return code2;
            })
          })
        );
        return code;
      }
      return this.content(options);
    }
    header() {
      let code = "";
      code += this.needContext() ? "var _context = {};\n" : "var _context;\n";
      code += "var _x = this._x;\n";
      if (this.options.interceptors.length > 0) {
        code += "var _taps = this.taps;\n";
        code += "var _interceptors = this.interceptors;\n";
      }
      return code;
    }
    needContext() {
      for (const tap of this.options.taps) if (tap.context) return true;
      return false;
    }
    callTap(tapIndex, { onError: onError2, onResult, onDone, rethrowIfPossible }) {
      let code = "";
      let hasTapCached = false;
      for (let i2 = 0; i2 < this.options.interceptors.length; i2++) {
        const interceptor = this.options.interceptors[i2];
        if (interceptor.tap) {
          if (!hasTapCached) {
            code += `var _tap${tapIndex} = ${this.getTap(tapIndex)};
`;
            hasTapCached = true;
          }
          code += `${this.getInterceptor(i2)}.tap(${interceptor.context ? "_context, " : ""}_tap${tapIndex});
`;
        }
      }
      code += `var _fn${tapIndex} = ${this.getTapFn(tapIndex)};
`;
      const tap = this.options.taps[tapIndex];
      switch (tap.type) {
        case "sync":
          if (!rethrowIfPossible) {
            code += `var _hasError${tapIndex} = false;
`;
            code += "try {\n";
          }
          if (onResult) {
            code += `var _result${tapIndex} = _fn${tapIndex}(${this.args({
              before: tap.context ? "_context" : void 0
            })});
`;
          } else {
            code += `_fn${tapIndex}(${this.args({
              before: tap.context ? "_context" : void 0
            })});
`;
          }
          if (!rethrowIfPossible) {
            code += "} catch(_err) {\n";
            code += `_hasError${tapIndex} = true;
`;
            code += onError2("_err");
            code += "}\n";
            code += `if(!_hasError${tapIndex}) {
`;
          }
          if (onResult) {
            code += onResult(`_result${tapIndex}`);
          }
          if (onDone) {
            code += onDone();
          }
          if (!rethrowIfPossible) {
            code += "}\n";
          }
          break;
        case "async": {
          let cbCode = "";
          cbCode += onResult ? `(function(_err${tapIndex}, _result${tapIndex}) {
` : `(function(_err${tapIndex}) {
`;
          cbCode += `if(_err${tapIndex}) {
`;
          cbCode += onError2(`_err${tapIndex}`);
          cbCode += "} else {\n";
          if (onResult) {
            cbCode += onResult(`_result${tapIndex}`);
          }
          if (onDone) {
            cbCode += onDone();
          }
          cbCode += "}\n";
          cbCode += "})";
          code += `_fn${tapIndex}(${this.args({
            before: tap.context ? "_context" : void 0,
            after: cbCode
          })});
`;
          break;
        }
        case "promise":
          code += `var _hasResult${tapIndex} = false;
`;
          code += `var _promise${tapIndex} = _fn${tapIndex}(${this.args({
            before: tap.context ? "_context" : void 0
          })});
`;
          code += `if (!_promise${tapIndex} || !_promise${tapIndex}.then)
`;
          code += `  throw new Error('Tap function (tapPromise) did not return promise (returned ' + _promise${tapIndex} + ')');
`;
          code += `_promise${tapIndex}.then((function(_result${tapIndex}) {
`;
          code += `_hasResult${tapIndex} = true;
`;
          if (onResult) {
            code += onResult(`_result${tapIndex}`);
          }
          if (onDone) {
            code += onDone();
          }
          code += `}), function(_err${tapIndex}) {
`;
          code += `if(_hasResult${tapIndex}) throw _err${tapIndex};
`;
          code += onError2(
            `!_err${tapIndex} ? new Error('Tap function (tapPromise) rejects "' + _err${tapIndex} + '" value') : _err${tapIndex}`
          );
          code += "});\n";
          break;
      }
      return code;
    }
    callTapsSeries({
      onError: onError2,
      onResult,
      resultReturns,
      onDone,
      doneReturns,
      rethrowIfPossible
    }) {
      if (this.options.taps.length === 0) return onDone();
      const firstAsync = this.options.taps.findIndex((t) => t.type !== "sync");
      const somethingReturns = resultReturns || doneReturns;
      let code = "";
      let current = onDone;
      let unrollCounter = 0;
      for (let j = this.options.taps.length - 1; j >= 0; j--) {
        const i2 = j;
        const unroll = current !== onDone && (this.options.taps[i2].type !== "sync" || unrollCounter++ > 20);
        if (unroll) {
          unrollCounter = 0;
          code += `function _next${i2}() {
`;
          code += current();
          code += "}\n";
          current = /* @__PURE__ */ __name(() => `${somethingReturns ? "return " : ""}_next${i2}();
`, "current");
        }
        const done = current;
        const doneBreak = /* @__PURE__ */ __name((skipDone) => {
          if (skipDone) return "";
          return onDone();
        }, "doneBreak");
        const content = this.callTap(i2, {
          onError: /* @__PURE__ */ __name((error) => onError2(i2, error, done, doneBreak), "onError"),
          onResult: onResult && ((result) => onResult(i2, result, done, doneBreak)),
          onDone: !onResult && done,
          rethrowIfPossible: rethrowIfPossible && (firstAsync < 0 || i2 < firstAsync)
        });
        current = /* @__PURE__ */ __name(() => content, "current");
      }
      code += current();
      return code;
    }
    callTapsLooping({ onError: onError2, onDone, rethrowIfPossible }) {
      if (this.options.taps.length === 0) return onDone();
      const syncOnly = this.options.taps.every((t) => t.type === "sync");
      let code = "";
      if (!syncOnly) {
        code += "var _looper = (function() {\n";
        code += "var _loopAsync = false;\n";
      }
      code += "var _loop;\n";
      code += "do {\n";
      code += "_loop = false;\n";
      for (let i2 = 0; i2 < this.options.interceptors.length; i2++) {
        const interceptor = this.options.interceptors[i2];
        if (interceptor.loop) {
          code += `${this.getInterceptor(i2)}.loop(${this.args({
            before: interceptor.context ? "_context" : void 0
          })});
`;
        }
      }
      code += this.callTapsSeries({
        onError: onError2,
        onResult: /* @__PURE__ */ __name((i2, result, next, doneBreak) => {
          let code2 = "";
          code2 += `if(${result} !== undefined) {
`;
          code2 += "_loop = true;\n";
          if (!syncOnly) code2 += "if(_loopAsync) _looper();\n";
          code2 += doneBreak(true);
          code2 += "} else {\n";
          code2 += next();
          code2 += "}\n";
          return code2;
        }, "onResult"),
        onDone: onDone && (() => {
          let code2 = "";
          code2 += "if(!_loop) {\n";
          code2 += onDone();
          code2 += "}\n";
          return code2;
        }),
        rethrowIfPossible: rethrowIfPossible && syncOnly
      });
      code += "} while(_loop);\n";
      if (!syncOnly) {
        code += "_loopAsync = true;\n";
        code += "});\n";
        code += "_looper();\n";
      }
      return code;
    }
    callTapsParallel({
      onError: onError2,
      onResult,
      onDone,
      rethrowIfPossible,
      onTap = /* @__PURE__ */ __name((i2, run) => run(), "onTap")
    }) {
      if (this.options.taps.length <= 1) {
        return this.callTapsSeries({
          onError: onError2,
          onResult,
          onDone,
          rethrowIfPossible
        });
      }
      let code = "";
      code += "do {\n";
      code += `var _counter = ${this.options.taps.length};
`;
      if (onDone) {
        code += "var _done = (function() {\n";
        code += onDone();
        code += "});\n";
      }
      for (let i2 = 0; i2 < this.options.taps.length; i2++) {
        const done = /* @__PURE__ */ __name(() => {
          if (onDone) return "if(--_counter === 0) _done();\n";
          return "--_counter;";
        }, "done");
        const doneBreak = /* @__PURE__ */ __name((skipDone) => {
          if (skipDone || !onDone) return "_counter = 0;\n";
          return "_counter = 0;\n_done();\n";
        }, "doneBreak");
        code += "if(_counter <= 0) break;\n";
        code += onTap(
          i2,
          () => this.callTap(i2, {
            onError: /* @__PURE__ */ __name((error) => {
              let code2 = "";
              code2 += "if(_counter > 0) {\n";
              code2 += onError2(i2, error, done, doneBreak);
              code2 += "}\n";
              return code2;
            }, "onError"),
            onResult: onResult && ((result) => {
              let code2 = "";
              code2 += "if(_counter > 0) {\n";
              code2 += onResult(i2, result, done, doneBreak);
              code2 += "}\n";
              return code2;
            }),
            onDone: !onResult && (() => done()),
            rethrowIfPossible
          }),
          done,
          doneBreak
        );
      }
      code += "} while(false);\n";
      return code;
    }
    args({ before, after } = {}) {
      let allArgs = this._args;
      if (before) allArgs = [before, ...allArgs];
      if (after) allArgs = [...allArgs, after];
      if (allArgs.length === 0) {
        return "";
      }
      return allArgs.join(", ");
    }
    getTapFn(idx) {
      return `_x[${idx}]`;
    }
    getTap(idx) {
      return `_taps[${idx}]`;
    }
    getInterceptor(idx) {
      return `_interceptors[${idx}]`;
    }
  };
  __name(_HookCodeFactory, "HookCodeFactory");
  let HookCodeFactory = _HookCodeFactory;
  HookCodeFactory_1 = HookCodeFactory;
  return HookCodeFactory_1;
}
__name(requireHookCodeFactory, "requireHookCodeFactory");
var AsyncParallelBailHook_1;
var hasRequiredAsyncParallelBailHook;
function requireAsyncParallelBailHook() {
  if (hasRequiredAsyncParallelBailHook) return AsyncParallelBailHook_1;
  hasRequiredAsyncParallelBailHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _AsyncParallelBailHookCodeFactory = class _AsyncParallelBailHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onResult, onDone }) {
      let code = "";
      code += `var _results = new Array(${this.options.taps.length});
`;
      code += "var _checkDone = function() {\n";
      code += "for(var i = 0; i < _results.length; i++) {\n";
      code += "var item = _results[i];\n";
      code += "if(item === undefined) return false;\n";
      code += "if(item.result !== undefined) {\n";
      code += onResult("item.result");
      code += "return true;\n";
      code += "}\n";
      code += "if(item.error) {\n";
      code += onError2("item.error");
      code += "return true;\n";
      code += "}\n";
      code += "}\n";
      code += "return false;\n";
      code += "}\n";
      code += this.callTapsParallel({
        onError: /* @__PURE__ */ __name((i2, err, done, doneBreak) => {
          let code2 = "";
          code2 += `if(${i2} < _results.length && ((_results.length = ${i2 + 1}), (_results[${i2}] = { error: ${err} }), _checkDone())) {
`;
          code2 += doneBreak(true);
          code2 += "} else {\n";
          code2 += done();
          code2 += "}\n";
          return code2;
        }, "onError"),
        onResult: /* @__PURE__ */ __name((i2, result, done, doneBreak) => {
          let code2 = "";
          code2 += `if(${i2} < _results.length && (${result} !== undefined && (_results.length = ${i2 + 1}), (_results[${i2}] = { result: ${result} }), _checkDone())) {
`;
          code2 += doneBreak(true);
          code2 += "} else {\n";
          code2 += done();
          code2 += "}\n";
          return code2;
        }, "onResult"),
        onTap: /* @__PURE__ */ __name((i2, run, done, _doneBreak) => {
          let code2 = "";
          if (i2 > 0) {
            code2 += `if(${i2} >= _results.length) {
`;
            code2 += done();
            code2 += "} else {\n";
          }
          code2 += run();
          if (i2 > 0) code2 += "}\n";
          return code2;
        }, "onTap"),
        onDone
      });
      return code;
    }
  };
  __name(_AsyncParallelBailHookCodeFactory, "AsyncParallelBailHookCodeFactory");
  let AsyncParallelBailHookCodeFactory = _AsyncParallelBailHookCodeFactory;
  const factory = new AsyncParallelBailHookCodeFactory();
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function AsyncParallelBailHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = AsyncParallelBailHook;
    hook.compile = COMPILE;
    hook._call = void 0;
    hook.call = void 0;
    return hook;
  }
  __name(AsyncParallelBailHook, "AsyncParallelBailHook");
  AsyncParallelBailHook.prototype = null;
  AsyncParallelBailHook_1 = AsyncParallelBailHook;
  return AsyncParallelBailHook_1;
}
__name(requireAsyncParallelBailHook, "requireAsyncParallelBailHook");
var AsyncParallelHook_1;
var hasRequiredAsyncParallelHook;
function requireAsyncParallelHook() {
  if (hasRequiredAsyncParallelHook) return AsyncParallelHook_1;
  hasRequiredAsyncParallelHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _AsyncParallelHookCodeFactory = class _AsyncParallelHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onDone }) {
      return this.callTapsParallel({
        onError: /* @__PURE__ */ __name((i2, err, done, doneBreak) => onError2(err) + doneBreak(true), "onError"),
        onDone
      });
    }
  };
  __name(_AsyncParallelHookCodeFactory, "AsyncParallelHookCodeFactory");
  let AsyncParallelHookCodeFactory = _AsyncParallelHookCodeFactory;
  const factory = new AsyncParallelHookCodeFactory();
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function AsyncParallelHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = AsyncParallelHook;
    hook.compile = COMPILE;
    hook._call = void 0;
    hook.call = void 0;
    return hook;
  }
  __name(AsyncParallelHook, "AsyncParallelHook");
  AsyncParallelHook.prototype = null;
  AsyncParallelHook_1 = AsyncParallelHook;
  return AsyncParallelHook_1;
}
__name(requireAsyncParallelHook, "requireAsyncParallelHook");
var AsyncSeriesBailHook_1;
var hasRequiredAsyncSeriesBailHook;
function requireAsyncSeriesBailHook() {
  if (hasRequiredAsyncSeriesBailHook) return AsyncSeriesBailHook_1;
  hasRequiredAsyncSeriesBailHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _AsyncSeriesBailHookCodeFactory = class _AsyncSeriesBailHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onResult, resultReturns, onDone }) {
      return this.callTapsSeries({
        onError: /* @__PURE__ */ __name((i2, err, next, doneBreak) => onError2(err) + doneBreak(true), "onError"),
        onResult: /* @__PURE__ */ __name((i2, result, next) => `if(${result} !== undefined) {
${onResult(
          result
        )}
} else {
${next()}}
`, "onResult"),
        resultReturns,
        onDone
      });
    }
  };
  __name(_AsyncSeriesBailHookCodeFactory, "AsyncSeriesBailHookCodeFactory");
  let AsyncSeriesBailHookCodeFactory = _AsyncSeriesBailHookCodeFactory;
  const factory = new AsyncSeriesBailHookCodeFactory();
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function AsyncSeriesBailHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = AsyncSeriesBailHook;
    hook.compile = COMPILE;
    hook._call = void 0;
    hook.call = void 0;
    return hook;
  }
  __name(AsyncSeriesBailHook, "AsyncSeriesBailHook");
  AsyncSeriesBailHook.prototype = null;
  AsyncSeriesBailHook_1 = AsyncSeriesBailHook;
  return AsyncSeriesBailHook_1;
}
__name(requireAsyncSeriesBailHook, "requireAsyncSeriesBailHook");
var AsyncSeriesHook_1;
var hasRequiredAsyncSeriesHook;
function requireAsyncSeriesHook() {
  if (hasRequiredAsyncSeriesHook) return AsyncSeriesHook_1;
  hasRequiredAsyncSeriesHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _AsyncSeriesHookCodeFactory = class _AsyncSeriesHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onDone }) {
      return this.callTapsSeries({
        onError: /* @__PURE__ */ __name((i2, err, next, doneBreak) => onError2(err) + doneBreak(true), "onError"),
        onDone
      });
    }
  };
  __name(_AsyncSeriesHookCodeFactory, "AsyncSeriesHookCodeFactory");
  let AsyncSeriesHookCodeFactory = _AsyncSeriesHookCodeFactory;
  const factory = new AsyncSeriesHookCodeFactory();
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function AsyncSeriesHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = AsyncSeriesHook;
    hook.compile = COMPILE;
    hook._call = void 0;
    hook.call = void 0;
    return hook;
  }
  __name(AsyncSeriesHook, "AsyncSeriesHook");
  AsyncSeriesHook.prototype = null;
  AsyncSeriesHook_1 = AsyncSeriesHook;
  return AsyncSeriesHook_1;
}
__name(requireAsyncSeriesHook, "requireAsyncSeriesHook");
var AsyncSeriesLoopHook_1;
var hasRequiredAsyncSeriesLoopHook;
function requireAsyncSeriesLoopHook() {
  if (hasRequiredAsyncSeriesLoopHook) return AsyncSeriesLoopHook_1;
  hasRequiredAsyncSeriesLoopHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _AsyncSeriesLoopHookCodeFactory = class _AsyncSeriesLoopHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onDone }) {
      return this.callTapsLooping({
        onError: /* @__PURE__ */ __name((i2, err, next, doneBreak) => onError2(err) + doneBreak(true), "onError"),
        onDone
      });
    }
  };
  __name(_AsyncSeriesLoopHookCodeFactory, "AsyncSeriesLoopHookCodeFactory");
  let AsyncSeriesLoopHookCodeFactory = _AsyncSeriesLoopHookCodeFactory;
  const factory = new AsyncSeriesLoopHookCodeFactory();
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function AsyncSeriesLoopHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = AsyncSeriesLoopHook;
    hook.compile = COMPILE;
    hook._call = void 0;
    hook.call = void 0;
    return hook;
  }
  __name(AsyncSeriesLoopHook, "AsyncSeriesLoopHook");
  AsyncSeriesLoopHook.prototype = null;
  AsyncSeriesLoopHook_1 = AsyncSeriesLoopHook;
  return AsyncSeriesLoopHook_1;
}
__name(requireAsyncSeriesLoopHook, "requireAsyncSeriesLoopHook");
var AsyncSeriesWaterfallHook_1;
var hasRequiredAsyncSeriesWaterfallHook;
function requireAsyncSeriesWaterfallHook() {
  if (hasRequiredAsyncSeriesWaterfallHook) return AsyncSeriesWaterfallHook_1;
  hasRequiredAsyncSeriesWaterfallHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _AsyncSeriesWaterfallHookCodeFactory = class _AsyncSeriesWaterfallHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onResult, _onDone }) {
      return this.callTapsSeries({
        onError: /* @__PURE__ */ __name((i2, err, next, doneBreak) => onError2(err) + doneBreak(true), "onError"),
        onResult: /* @__PURE__ */ __name((i2, result, next) => {
          let code = "";
          code += `if(${result} !== undefined) {
`;
          code += `${this._args[0]} = ${result};
`;
          code += "}\n";
          code += next();
          return code;
        }, "onResult"),
        onDone: /* @__PURE__ */ __name(() => onResult(this._args[0]), "onDone")
      });
    }
  };
  __name(_AsyncSeriesWaterfallHookCodeFactory, "AsyncSeriesWaterfallHookCodeFactory");
  let AsyncSeriesWaterfallHookCodeFactory = _AsyncSeriesWaterfallHookCodeFactory;
  const factory = new AsyncSeriesWaterfallHookCodeFactory();
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function AsyncSeriesWaterfallHook(args = [], name2 = void 0) {
    if (args.length < 1) {
      throw new Error("Waterfall hooks must have at least one argument");
    }
    const hook = new Hook(args, name2);
    hook.constructor = AsyncSeriesWaterfallHook;
    hook.compile = COMPILE;
    hook._call = void 0;
    hook.call = void 0;
    return hook;
  }
  __name(AsyncSeriesWaterfallHook, "AsyncSeriesWaterfallHook");
  AsyncSeriesWaterfallHook.prototype = null;
  AsyncSeriesWaterfallHook_1 = AsyncSeriesWaterfallHook;
  return AsyncSeriesWaterfallHook_1;
}
__name(requireAsyncSeriesWaterfallHook, "requireAsyncSeriesWaterfallHook");
var HookMap_1;
var hasRequiredHookMap;
function requireHookMap() {
  if (hasRequiredHookMap) return HookMap_1;
  hasRequiredHookMap = 1;
  const util2 = require$$0$3;
  const defaultFactory = /* @__PURE__ */ __name((key, hook) => hook, "defaultFactory");
  const _HookMap = class _HookMap {
    constructor(factory, name2 = void 0) {
      this._map = /* @__PURE__ */ new Map();
      this.name = name2;
      this._factory = factory;
      this._interceptors = [];
    }
    get(key) {
      return this._map.get(key);
    }
    for(key) {
      const hook = this.get(key);
      if (hook !== void 0) {
        return hook;
      }
      let newHook = this._factory(key);
      const interceptors = this._interceptors;
      for (let i2 = 0; i2 < interceptors.length; i2++) {
        newHook = interceptors[i2].factory(key, newHook);
      }
      this._map.set(key, newHook);
      return newHook;
    }
    intercept(interceptor) {
      this._interceptors.push(
        Object.assign(
          {
            factory: defaultFactory
          },
          interceptor
        )
      );
    }
  };
  __name(_HookMap, "HookMap");
  let HookMap = _HookMap;
  HookMap.prototype.tap = util2.deprecate(/* @__PURE__ */ __name(function tap(key, options, fn) {
    return this.for(key).tap(options, fn);
  }, "tap"), "HookMap#tap(key,…) is deprecated. Use HookMap#for(key).tap(…) instead.");
  HookMap.prototype.tapAsync = util2.deprecate(/* @__PURE__ */ __name(function tapAsync(key, options, fn) {
    return this.for(key).tapAsync(options, fn);
  }, "tapAsync"), "HookMap#tapAsync(key,…) is deprecated. Use HookMap#for(key).tapAsync(…) instead.");
  HookMap.prototype.tapPromise = util2.deprecate(/* @__PURE__ */ __name(function tapPromise(key, options, fn) {
    return this.for(key).tapPromise(options, fn);
  }, "tapPromise"), "HookMap#tapPromise(key,…) is deprecated. Use HookMap#for(key).tapPromise(…) instead.");
  HookMap_1 = HookMap;
  return HookMap_1;
}
__name(requireHookMap, "requireHookMap");
var MultiHook_1;
var hasRequiredMultiHook;
function requireMultiHook() {
  if (hasRequiredMultiHook) return MultiHook_1;
  hasRequiredMultiHook = 1;
  const _MultiHook = class _MultiHook {
    constructor(hooks, name2 = void 0) {
      this.hooks = hooks;
      this.name = name2;
    }
    tap(options, fn) {
      for (const hook of this.hooks) {
        hook.tap(options, fn);
      }
    }
    tapAsync(options, fn) {
      for (const hook of this.hooks) {
        hook.tapAsync(options, fn);
      }
    }
    tapPromise(options, fn) {
      for (const hook of this.hooks) {
        hook.tapPromise(options, fn);
      }
    }
    isUsed() {
      for (const hook of this.hooks) {
        if (hook.isUsed()) return true;
      }
      return false;
    }
    intercept(interceptor) {
      for (const hook of this.hooks) {
        hook.intercept(interceptor);
      }
    }
    withOptions(options) {
      return new _MultiHook(
        this.hooks.map((hook) => hook.withOptions(options)),
        this.name
      );
    }
  };
  __name(_MultiHook, "MultiHook");
  let MultiHook = _MultiHook;
  MultiHook_1 = MultiHook;
  return MultiHook_1;
}
__name(requireMultiHook, "requireMultiHook");
var SyncBailHook_1;
var hasRequiredSyncBailHook;
function requireSyncBailHook() {
  if (hasRequiredSyncBailHook) return SyncBailHook_1;
  hasRequiredSyncBailHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _SyncBailHookCodeFactory = class _SyncBailHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onResult, resultReturns, onDone, rethrowIfPossible }) {
      return this.callTapsSeries({
        onError: /* @__PURE__ */ __name((i2, err) => onError2(err), "onError"),
        onResult: /* @__PURE__ */ __name((i2, result, next) => `if(${result} !== undefined) {
${onResult(
          result
        )};
} else {
${next()}}
`, "onResult"),
        resultReturns,
        onDone,
        rethrowIfPossible
      });
    }
  };
  __name(_SyncBailHookCodeFactory, "SyncBailHookCodeFactory");
  let SyncBailHookCodeFactory = _SyncBailHookCodeFactory;
  const factory = new SyncBailHookCodeFactory();
  const TAP_ASYNC = /* @__PURE__ */ __name(() => {
    throw new Error("tapAsync is not supported on a SyncBailHook");
  }, "TAP_ASYNC");
  const TAP_PROMISE = /* @__PURE__ */ __name(() => {
    throw new Error("tapPromise is not supported on a SyncBailHook");
  }, "TAP_PROMISE");
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function SyncBailHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = SyncBailHook;
    hook.tapAsync = TAP_ASYNC;
    hook.tapPromise = TAP_PROMISE;
    hook.compile = COMPILE;
    return hook;
  }
  __name(SyncBailHook, "SyncBailHook");
  SyncBailHook.prototype = null;
  SyncBailHook_1 = SyncBailHook;
  return SyncBailHook_1;
}
__name(requireSyncBailHook, "requireSyncBailHook");
var SyncHook_1;
var hasRequiredSyncHook;
function requireSyncHook() {
  if (hasRequiredSyncHook) return SyncHook_1;
  hasRequiredSyncHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _SyncHookCodeFactory = class _SyncHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onDone, rethrowIfPossible }) {
      return this.callTapsSeries({
        onError: /* @__PURE__ */ __name((i2, err) => onError2(err), "onError"),
        onDone,
        rethrowIfPossible
      });
    }
  };
  __name(_SyncHookCodeFactory, "SyncHookCodeFactory");
  let SyncHookCodeFactory = _SyncHookCodeFactory;
  const factory = new SyncHookCodeFactory();
  const TAP_ASYNC = /* @__PURE__ */ __name(() => {
    throw new Error("tapAsync is not supported on a SyncHook");
  }, "TAP_ASYNC");
  const TAP_PROMISE = /* @__PURE__ */ __name(() => {
    throw new Error("tapPromise is not supported on a SyncHook");
  }, "TAP_PROMISE");
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function SyncHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = SyncHook;
    hook.tapAsync = TAP_ASYNC;
    hook.tapPromise = TAP_PROMISE;
    hook.compile = COMPILE;
    return hook;
  }
  __name(SyncHook, "SyncHook");
  SyncHook.prototype = null;
  SyncHook_1 = SyncHook;
  return SyncHook_1;
}
__name(requireSyncHook, "requireSyncHook");
var SyncLoopHook_1;
var hasRequiredSyncLoopHook;
function requireSyncLoopHook() {
  if (hasRequiredSyncLoopHook) return SyncLoopHook_1;
  hasRequiredSyncLoopHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _SyncLoopHookCodeFactory = class _SyncLoopHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onDone, rethrowIfPossible }) {
      return this.callTapsLooping({
        onError: /* @__PURE__ */ __name((i2, err) => onError2(err), "onError"),
        onDone,
        rethrowIfPossible
      });
    }
  };
  __name(_SyncLoopHookCodeFactory, "SyncLoopHookCodeFactory");
  let SyncLoopHookCodeFactory = _SyncLoopHookCodeFactory;
  const factory = new SyncLoopHookCodeFactory();
  const TAP_ASYNC = /* @__PURE__ */ __name(() => {
    throw new Error("tapAsync is not supported on a SyncLoopHook");
  }, "TAP_ASYNC");
  const TAP_PROMISE = /* @__PURE__ */ __name(() => {
    throw new Error("tapPromise is not supported on a SyncLoopHook");
  }, "TAP_PROMISE");
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function SyncLoopHook(args = [], name2 = void 0) {
    const hook = new Hook(args, name2);
    hook.constructor = SyncLoopHook;
    hook.tapAsync = TAP_ASYNC;
    hook.tapPromise = TAP_PROMISE;
    hook.compile = COMPILE;
    return hook;
  }
  __name(SyncLoopHook, "SyncLoopHook");
  SyncLoopHook.prototype = null;
  SyncLoopHook_1 = SyncLoopHook;
  return SyncLoopHook_1;
}
__name(requireSyncLoopHook, "requireSyncLoopHook");
var SyncWaterfallHook_1;
var hasRequiredSyncWaterfallHook;
function requireSyncWaterfallHook() {
  if (hasRequiredSyncWaterfallHook) return SyncWaterfallHook_1;
  hasRequiredSyncWaterfallHook = 1;
  const Hook = requireHook();
  const HookCodeFactory = requireHookCodeFactory();
  const _SyncWaterfallHookCodeFactory = class _SyncWaterfallHookCodeFactory extends HookCodeFactory {
    content({ onError: onError2, onResult, resultReturns, rethrowIfPossible }) {
      return this.callTapsSeries({
        onError: /* @__PURE__ */ __name((i2, err) => onError2(err), "onError"),
        onResult: /* @__PURE__ */ __name((i2, result, next) => {
          let code = "";
          code += `if(${result} !== undefined) {
`;
          code += `${this._args[0]} = ${result};
`;
          code += "}\n";
          code += next();
          return code;
        }, "onResult"),
        onDone: /* @__PURE__ */ __name(() => onResult(this._args[0]), "onDone"),
        doneReturns: resultReturns,
        rethrowIfPossible
      });
    }
  };
  __name(_SyncWaterfallHookCodeFactory, "SyncWaterfallHookCodeFactory");
  let SyncWaterfallHookCodeFactory = _SyncWaterfallHookCodeFactory;
  const factory = new SyncWaterfallHookCodeFactory();
  const TAP_ASYNC = /* @__PURE__ */ __name(() => {
    throw new Error("tapAsync is not supported on a SyncWaterfallHook");
  }, "TAP_ASYNC");
  const TAP_PROMISE = /* @__PURE__ */ __name(() => {
    throw new Error("tapPromise is not supported on a SyncWaterfallHook");
  }, "TAP_PROMISE");
  function COMPILE(options) {
    factory.setup(this, options);
    return factory.create(options);
  }
  __name(COMPILE, "COMPILE");
  function SyncWaterfallHook(args = [], name2 = void 0) {
    if (args.length < 1) {
      throw new Error("Waterfall hooks must have at least one argument");
    }
    const hook = new Hook(args, name2);
    hook.constructor = SyncWaterfallHook;
    hook.tapAsync = TAP_ASYNC;
    hook.tapPromise = TAP_PROMISE;
    hook.compile = COMPILE;
    return hook;
  }
  __name(SyncWaterfallHook, "SyncWaterfallHook");
  SyncWaterfallHook.prototype = null;
  SyncWaterfallHook_1 = SyncWaterfallHook;
  return SyncWaterfallHook_1;
}
__name(requireSyncWaterfallHook, "requireSyncWaterfallHook");
var hasRequiredLib;
function requireLib() {
  if (hasRequiredLib) return lib$1;
  hasRequiredLib = 1;
  lib$1.AsyncParallelBailHook = requireAsyncParallelBailHook();
  lib$1.AsyncParallelHook = requireAsyncParallelHook();
  lib$1.AsyncSeriesBailHook = requireAsyncSeriesBailHook();
  lib$1.AsyncSeriesHook = requireAsyncSeriesHook();
  lib$1.AsyncSeriesLoopHook = requireAsyncSeriesLoopHook();
  lib$1.AsyncSeriesWaterfallHook = requireAsyncSeriesWaterfallHook();
  lib$1.HookMap = requireHookMap();
  lib$1.MultiHook = requireMultiHook();
  lib$1.SyncBailHook = requireSyncBailHook();
  lib$1.SyncHook = requireSyncHook();
  lib$1.SyncLoopHook = requireSyncLoopHook();
  lib$1.SyncWaterfallHook = requireSyncWaterfallHook();
  lib$1.__esModule = true;
  return lib$1;
}
__name(requireLib, "requireLib");
var createInnerContext;
var hasRequiredCreateInnerContext;
function requireCreateInnerContext() {
  if (hasRequiredCreateInnerContext) return createInnerContext;
  hasRequiredCreateInnerContext = 1;
  createInnerContext = /* @__PURE__ */ __name(function createInnerContext2(options, message) {
    let messageReported = false;
    let innerLog;
    if (options.log) {
      if (message) {
        innerLog = /* @__PURE__ */ __name((msg) => {
          if (!messageReported) {
            options.log(message);
            messageReported = true;
          }
          options.log(`  ${msg}`);
        }, "innerLog");
      } else {
        innerLog = options.log;
      }
    }
    return {
      log: innerLog,
      yield: options.yield,
      fileDependencies: options.fileDependencies,
      contextDependencies: options.contextDependencies,
      missingDependencies: options.missingDependencies,
      stack: options.stack
    };
  }, "createInnerContext");
  return createInnerContext;
}
__name(requireCreateInnerContext, "requireCreateInnerContext");
var Resolver_1;
var hasRequiredResolver;
function requireResolver() {
  if (hasRequiredResolver) return Resolver_1;
  hasRequiredResolver = 1;
  const { AsyncSeriesBailHook, AsyncSeriesHook, SyncHook } = requireLib();
  const createInnerContext2 = requireCreateInnerContext();
  const { parseIdentifier } = requireIdentifier();
  const {
    PathType,
    cachedJoin: join,
    getType,
    normalize
  } = requirePath();
  function toCamelCase(str) {
    return str.replace(/-([a-z])/g, (str2) => str2.slice(1).toUpperCase());
  }
  __name(toCamelCase, "toCamelCase");
  const _Resolver = class _Resolver {
    /**
     * @param {ResolveStepHook} hook hook
     * @param {ResolveRequest} request request
     * @returns {StackEntry} stack entry
     */
    static createStackEntry(hook, request) {
      return `${hook.name}: (${request.path}) ${request.request || ""}${request.query || ""}${request.fragment || ""}${request.directory ? " directory" : ""}${request.module ? " module" : ""}`;
    }
    /**
     * @param {FileSystem} fileSystem a filesystem
     * @param {ResolveOptions} options options
     */
    constructor(fileSystem, options) {
      this.fileSystem = fileSystem;
      this.options = options;
      this.hooks = {
        resolveStep: new SyncHook(["hook", "request"], "resolveStep"),
        noResolve: new SyncHook(["request", "error"], "noResolve"),
        resolve: new AsyncSeriesBailHook(
          ["request", "resolveContext"],
          "resolve"
        ),
        result: new AsyncSeriesHook(["result", "resolveContext"], "result")
      };
    }
    /**
     * @param {string | ResolveStepHook} name hook name or hook itself
     * @returns {ResolveStepHook} the hook
     */
    ensureHook(name2) {
      if (typeof name2 !== "string") {
        return name2;
      }
      name2 = toCamelCase(name2);
      if (name2.startsWith("before")) {
        return (
          /** @type {ResolveStepHook} */
          this.ensureHook(name2[6].toLowerCase() + name2.slice(7)).withOptions({
            stage: -10
          })
        );
      }
      if (name2.startsWith("after")) {
        return (
          /** @type {ResolveStepHook} */
          this.ensureHook(name2[5].toLowerCase() + name2.slice(6)).withOptions({
            stage: 10
          })
        );
      }
      const hook = (
        /** @type {KnownHooks & EnsuredHooks} */
        this.hooks[name2]
      );
      if (!hook) {
        this.hooks[name2] = new AsyncSeriesBailHook(
          ["request", "resolveContext"],
          name2
        );
        return (
          /** @type {KnownHooks & EnsuredHooks} */
          this.hooks[name2]
        );
      }
      return hook;
    }
    /**
     * @param {string | ResolveStepHook} name hook name or hook itself
     * @returns {ResolveStepHook} the hook
     */
    getHook(name2) {
      if (typeof name2 !== "string") {
        return name2;
      }
      name2 = toCamelCase(name2);
      if (name2.startsWith("before")) {
        return (
          /** @type {ResolveStepHook} */
          this.getHook(name2[6].toLowerCase() + name2.slice(7)).withOptions({
            stage: -10
          })
        );
      }
      if (name2.startsWith("after")) {
        return (
          /** @type {ResolveStepHook} */
          this.getHook(name2[5].toLowerCase() + name2.slice(6)).withOptions({
            stage: 10
          })
        );
      }
      const hook = (
        /** @type {KnownHooks & EnsuredHooks} */
        this.hooks[name2]
      );
      if (!hook) {
        throw new Error(`Hook ${name2} doesn't exist`);
      }
      return hook;
    }
    /**
     * @param {object} context context information object
     * @param {string} path context path
     * @param {string} request request string
     * @returns {string | false} result
     */
    resolveSync(context, path2, request) {
      let err;
      let result;
      let sync = false;
      this.resolve(context, path2, request, {}, (_err, r) => {
        err = _err;
        result = r;
        sync = true;
      });
      if (!sync) {
        throw new Error(
          "Cannot 'resolveSync' because the fileSystem is not sync. Use 'resolve'!"
        );
      }
      if (err) throw err;
      if (result === void 0) throw new Error("No result");
      return result;
    }
    /**
     * @param {object} context context information object
     * @param {string} path context path
     * @param {string} request request string
     * @param {ResolveContext} resolveContext resolve context
     * @param {ResolveCallback} callback callback function
     * @returns {void}
     */
    resolve(context, path2, request, resolveContext, callback) {
      if (!context || typeof context !== "object") {
        return callback(new Error("context argument is not an object"));
      }
      if (typeof path2 !== "string") {
        return callback(new Error("path argument is not a string"));
      }
      if (typeof request !== "string") {
        return callback(new Error("request argument is not a string"));
      }
      if (!resolveContext) {
        return callback(new Error("resolveContext argument is not set"));
      }
      const obj = {
        context,
        path: path2,
        request
      };
      let yield_;
      let yieldCalled = false;
      let finishYield;
      if (typeof resolveContext.yield === "function") {
        const old = resolveContext.yield;
        yield_ = /* @__PURE__ */ __name((obj2) => {
          old(obj2);
          yieldCalled = true;
        }, "yield_");
        finishYield = /* @__PURE__ */ __name((result) => {
          if (result) {
            yield_(result);
          }
          callback(null);
        }, "finishYield");
      }
      const message = `resolve '${request}' in '${path2}'`;
      const finishResolved = /* @__PURE__ */ __name((result) => callback(
        null,
        result.path === false ? false : `${result.path.replace(/#/g, "\0#")}${result.query ? result.query.replace(/#/g, "\0#") : ""}${result.fragment || ""}`,
        result
      ), "finishResolved");
      const finishWithoutResolve = /* @__PURE__ */ __name((log) => {
        const error = new Error(`Can't ${message}`);
        error.details = log.join("\n");
        this.hooks.noResolve.call(obj, error);
        return callback(error);
      }, "finishWithoutResolve");
      if (resolveContext.log) {
        const parentLog = resolveContext.log;
        const log = [];
        return this.doResolve(
          this.hooks.resolve,
          obj,
          message,
          {
            log: /* @__PURE__ */ __name((msg) => {
              parentLog(msg);
              log.push(msg);
            }, "log"),
            yield: yield_,
            fileDependencies: resolveContext.fileDependencies,
            contextDependencies: resolveContext.contextDependencies,
            missingDependencies: resolveContext.missingDependencies,
            stack: resolveContext.stack
          },
          (err, result) => {
            if (err) return callback(err);
            if (yieldCalled || result && yield_) {
              return (
                /** @type {ResolveContextYield} */
                finishYield(
                  /** @type {ResolveRequest} */
                  result
                )
              );
            }
            if (result) return finishResolved(result);
            return finishWithoutResolve(log);
          }
        );
      }
      return this.doResolve(
        this.hooks.resolve,
        obj,
        message,
        {
          log: void 0,
          yield: yield_,
          fileDependencies: resolveContext.fileDependencies,
          contextDependencies: resolveContext.contextDependencies,
          missingDependencies: resolveContext.missingDependencies,
          stack: resolveContext.stack
        },
        (err, result) => {
          if (err) return callback(err);
          if (yieldCalled || result && yield_) {
            return (
              /** @type {ResolveContextYield} */
              finishYield(
                /** @type {ResolveRequest} */
                result
              )
            );
          }
          if (result) return finishResolved(result);
          const log = [];
          return this.doResolve(
            this.hooks.resolve,
            obj,
            message,
            {
              log: /* @__PURE__ */ __name((msg) => log.push(msg), "log"),
              yield: yield_,
              stack: resolveContext.stack
            },
            (err2, result2) => {
              if (err2) return callback(err2);
              if (yieldCalled || result2 && yield_) {
                return (
                  /** @type {ResolveContextYield} */
                  finishYield(
                    /** @type {ResolveRequest} */
                    result2
                  )
                );
              }
              return finishWithoutResolve(log);
            }
          );
        }
      );
    }
    /**
     * @param {ResolveStepHook} hook hook
     * @param {ResolveRequest} request request
     * @param {null|string} message string
     * @param {ResolveContext} resolveContext resolver context
     * @param {(err?: null|Error, result?: ResolveRequest) => void} callback callback
     * @returns {void}
     */
    doResolve(hook, request, message, resolveContext, callback) {
      const stackEntry = _Resolver.createStackEntry(hook, request);
      let newStack;
      if (resolveContext.stack) {
        newStack = new Set(resolveContext.stack);
        if (resolveContext.stack.has(stackEntry)) {
          const recursionError = new Error(
            `Recursion in resolving
Stack:
  ${[...newStack].join("\n  ")}`
          );
          recursionError.recursion = true;
          if (resolveContext.log) {
            resolveContext.log("abort resolving because of recursion");
          }
          return callback(recursionError);
        }
        newStack.add(stackEntry);
      } else {
        newStack = /* @__PURE__ */ new Set();
        newStack.add(stackEntry);
      }
      this.hooks.resolveStep.call(hook, request);
      if (hook.isUsed()) {
        const innerContext = createInnerContext2(
          {
            log: resolveContext.log,
            yield: resolveContext.yield,
            fileDependencies: resolveContext.fileDependencies,
            contextDependencies: resolveContext.contextDependencies,
            missingDependencies: resolveContext.missingDependencies,
            stack: newStack
          },
          message
        );
        return hook.callAsync(request, innerContext, (err, result) => {
          if (err) return callback(err);
          if (result) return callback(null, result);
          callback();
        });
      }
      callback();
    }
    /**
     * @param {string} identifier identifier
     * @returns {ParsedIdentifier} parsed identifier
     */
    parse(identifier2) {
      const part = {
        request: "",
        query: "",
        fragment: "",
        module: false,
        directory: false,
        file: false,
        internal: false
      };
      const parsedIdentifier = parseIdentifier(identifier2);
      if (!parsedIdentifier) return part;
      [part.request, part.query, part.fragment] = parsedIdentifier;
      if (part.request.length > 0) {
        part.internal = this.isPrivate(identifier2);
        part.module = this.isModule(part.request);
        part.directory = this.isDirectory(part.request);
        if (part.directory) {
          part.request = part.request.slice(0, -1);
        }
      }
      return part;
    }
    /**
     * @param {string} path path
     * @returns {boolean} true, if the path is a module
     */
    isModule(path2) {
      return getType(path2) === PathType.Normal;
    }
    /**
     * @param {string} path path
     * @returns {boolean} true, if the path is private
     */
    isPrivate(path2) {
      return getType(path2) === PathType.Internal;
    }
    /**
     * @param {string} path a path
     * @returns {boolean} true, if the path is a directory path
     */
    isDirectory(path2) {
      return path2.endsWith("/");
    }
    /**
     * @param {string} path path
     * @param {string} request request
     * @returns {string} joined path
     */
    join(path2, request) {
      return join(path2, request);
    }
    /**
     * @param {string} path path
     * @returns {string} normalized path
     */
    normalize(path2) {
      return normalize(path2);
    }
  };
  __name(_Resolver, "Resolver");
  let Resolver = _Resolver;
  Resolver_1 = Resolver;
  return Resolver_1;
}
__name(requireResolver, "requireResolver");
var RestrictionsPlugin_1;
var hasRequiredRestrictionsPlugin;
function requireRestrictionsPlugin() {
  var _a2;
  if (hasRequiredRestrictionsPlugin) return RestrictionsPlugin_1;
  hasRequiredRestrictionsPlugin = 1;
  const slashCode = "/".charCodeAt(0);
  const backslashCode = "\\".charCodeAt(0);
  const isInside = /* @__PURE__ */ __name((path2, parent) => {
    if (!path2.startsWith(parent)) return false;
    if (path2.length === parent.length) return true;
    const charCode = path2.charCodeAt(parent.length);
    return charCode === slashCode || charCode === backslashCode;
  }, "isInside");
  RestrictionsPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {Set<string | RegExp>} restrictions restrictions
     */
    constructor(source, restrictions) {
      this.source = source;
      this.restrictions = restrictions;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      resolver2.getHook(this.source).tapAsync("RestrictionsPlugin", (request, resolveContext, callback) => {
        if (typeof request.path === "string") {
          const { path: path2 } = request;
          for (const rule of this.restrictions) {
            if (typeof rule === "string") {
              if (!isInside(path2, rule)) {
                if (resolveContext.log) {
                  resolveContext.log(
                    `${path2} is not inside of the restriction ${rule}`
                  );
                }
                return callback(null, null);
              }
            } else if (!rule.test(path2)) {
              if (resolveContext.log) {
                resolveContext.log(
                  `${path2} doesn't match the restriction ${rule}`
                );
              }
              return callback(null, null);
            }
          }
        }
        callback();
      });
    }
  }, __name(_a2, "RestrictionsPlugin"), _a2);
  return RestrictionsPlugin_1;
}
__name(requireRestrictionsPlugin, "requireRestrictionsPlugin");
var ResultPlugin_1;
var hasRequiredResultPlugin;
function requireResultPlugin() {
  var _a2;
  if (hasRequiredResultPlugin) return ResultPlugin_1;
  hasRequiredResultPlugin = 1;
  ResultPlugin_1 = (_a2 = class {
    /**
     * @param {ResolveStepHook} source source
     */
    constructor(source) {
      this.source = source;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      this.source.tapAsync(
        "ResultPlugin",
        (request, resolverContext, callback) => {
          const obj = { ...request };
          if (resolverContext.log) {
            resolverContext.log(`reporting result ${obj.path}`);
          }
          resolver2.hooks.result.callAsync(obj, resolverContext, (err) => {
            if (err) return callback(err);
            if (typeof resolverContext.yield === "function") {
              resolverContext.yield(obj);
              callback(null, null);
            } else {
              callback(null, obj);
            }
          });
        }
      );
    }
  }, __name(_a2, "ResultPlugin"), _a2);
  return ResultPlugin_1;
}
__name(requireResultPlugin, "requireResultPlugin");
var RootsPlugin_1;
var hasRequiredRootsPlugin;
function requireRootsPlugin() {
  if (hasRequiredRootsPlugin) return RootsPlugin_1;
  hasRequiredRootsPlugin = 1;
  const forEachBail2 = requireForEachBail();
  const _RootsPlugin = class _RootsPlugin {
    /**
     * @param {string | ResolveStepHook} source source hook
     * @param {Set<string>} roots roots
     * @param {string | ResolveStepHook} target target hook
     */
    constructor(source, roots, target) {
      this.roots = [...roots];
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("RootsPlugin", (request, resolveContext, callback) => {
        const req = request.request;
        if (!req) return callback();
        if (!req.startsWith("/")) return callback();
        forEachBail2(
          this.roots,
          /**
           * @param {string} root root
           * @param {(err?: null|Error, result?: null|ResolveRequest) => void} callback callback
           * @returns {void}
           */
          (root, callback2) => {
            const path2 = resolver2.join(root, req.slice(1));
            const obj = {
              ...request,
              path: path2,
              relativePath: request.relativePath && path2
            };
            resolver2.doResolve(
              target,
              obj,
              `root path ${root}`,
              resolveContext,
              callback2
            );
          },
          callback
        );
      });
    }
  };
  __name(_RootsPlugin, "RootsPlugin");
  let RootsPlugin = _RootsPlugin;
  RootsPlugin_1 = RootsPlugin;
  return RootsPlugin_1;
}
__name(requireRootsPlugin, "requireRootsPlugin");
var SelfReferencePlugin_1;
var hasRequiredSelfReferencePlugin;
function requireSelfReferencePlugin() {
  var _a2;
  if (hasRequiredSelfReferencePlugin) return SelfReferencePlugin_1;
  hasRequiredSelfReferencePlugin = 1;
  const DescriptionFileUtils2 = requireDescriptionFileUtils();
  const slashCode = "/".charCodeAt(0);
  SelfReferencePlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | string[]} fieldNamePath name path
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, fieldNamePath, target) {
      this.source = source;
      this.target = target;
      this.fieldName = fieldNamePath;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("SelfReferencePlugin", (request, resolveContext, callback) => {
        if (!request.descriptionFilePath) return callback();
        const req = request.request;
        if (!req) return callback();
        const exportsField = DescriptionFileUtils2.getField(
          /** @type {JsonObject} */
          request.descriptionFileData,
          this.fieldName
        );
        if (!exportsField) return callback();
        const name2 = DescriptionFileUtils2.getField(
          /** @type {JsonObject} */
          request.descriptionFileData,
          "name"
        );
        if (typeof name2 !== "string") return callback();
        if (req.startsWith(name2) && (req.length === name2.length || req.charCodeAt(name2.length) === slashCode)) {
          const remainingRequest = `.${req.slice(name2.length)}`;
          const obj = {
            ...request,
            request: remainingRequest,
            path: (
              /** @type {string} */
              request.descriptionFileRoot
            ),
            relativePath: "."
          };
          resolver2.doResolve(
            target,
            obj,
            "self reference",
            resolveContext,
            callback
          );
        } else {
          return callback();
        }
      });
    }
  }, __name(_a2, "SelfReferencePlugin"), _a2);
  return SelfReferencePlugin_1;
}
__name(requireSelfReferencePlugin, "requireSelfReferencePlugin");
var SymlinkPlugin_1;
var hasRequiredSymlinkPlugin;
function requireSymlinkPlugin() {
  var _a2;
  if (hasRequiredSymlinkPlugin) return SymlinkPlugin_1;
  hasRequiredSymlinkPlugin = 1;
  const forEachBail2 = requireForEachBail();
  const getPaths2 = requireGetPaths();
  const { PathType, getType } = requirePath();
  SymlinkPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, target) {
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      const fs = resolver2.fileSystem;
      resolver2.getHook(this.source).tapAsync("SymlinkPlugin", (request, resolveContext, callback) => {
        if (request.ignoreSymlinks) return callback();
        const pathsResult = getPaths2(
          /** @type {string} */
          request.path
        );
        const pathSegments = pathsResult.segments;
        const { paths } = pathsResult;
        let containsSymlink = false;
        let idx = -1;
        forEachBail2(
          paths,
          /**
           * @param {string} path path
           * @param {(err?: null|Error, result?: null|number) => void} callback callback
           * @returns {void}
           */
          (path2, callback2) => {
            idx++;
            if (resolveContext.fileDependencies) {
              resolveContext.fileDependencies.add(path2);
            }
            fs.readlink(path2, (err, result) => {
              if (!err && result) {
                pathSegments[idx] = /** @type {string} */
                result;
                containsSymlink = true;
                const resultType = getType(result.toString());
                if (resultType === PathType.AbsoluteWin || resultType === PathType.AbsolutePosix) {
                  return callback2(null, idx);
                }
              }
              callback2();
            });
          },
          /**
           * @param {(null | Error)=} err error
           * @param {(null|number)=} idx result
           * @returns {void}
           */
          (err, idx2) => {
            if (!containsSymlink) return callback();
            const resultSegments = typeof idx2 === "number" ? pathSegments.slice(0, idx2 + 1) : [...pathSegments];
            const result = resultSegments.reduceRight(
              (a2, b) => resolver2.join(a2, b)
            );
            const obj = {
              ...request,
              path: result
            };
            resolver2.doResolve(
              target,
              obj,
              `resolved symlink to ${result}`,
              resolveContext,
              callback
            );
          }
        );
      });
    }
  }, __name(_a2, "SymlinkPlugin"), _a2);
  return SymlinkPlugin_1;
}
__name(requireSymlinkPlugin, "requireSymlinkPlugin");
var SyncAsyncFileSystemDecorator_1;
var hasRequiredSyncAsyncFileSystemDecorator;
function requireSyncAsyncFileSystemDecorator() {
  if (hasRequiredSyncAsyncFileSystemDecorator) return SyncAsyncFileSystemDecorator_1;
  hasRequiredSyncAsyncFileSystemDecorator = 1;
  function SyncAsyncFileSystemDecorator(fs) {
    this.fs = fs;
    this.lstat = void 0;
    this.lstatSync = void 0;
    const { lstatSync } = fs;
    if (lstatSync) {
      this.lstat = /** @type {FileSystem["lstat"]} */
      (arg, options, callback) => {
        let result;
        try {
          result = /** @type {SyncOrAsyncFunction | undefined} */
          callback ? lstatSync.call(fs, arg, options) : lstatSync.call(fs, arg);
        } catch (err) {
          return (callback || options)(
            /** @type {NodeJS.ErrnoException | null} */
            err
          );
        }
        (callback || options)(
          null,
          /** @type {ResultOfSyncOrAsyncFunction} */
          result
        );
      };
      this.lstatSync = /** @type {SyncFileSystem["lstatSync"]} */
      (arg, options) => lstatSync.call(fs, arg, options);
    }
    this.stat = /** @type {FileSystem["stat"]} */
    (arg, options, callback) => {
      let result;
      try {
        result = /** @type {SyncOrAsyncFunction | undefined} */
        callback ? fs.statSync(arg, options) : fs.statSync(arg);
      } catch (err) {
        return (callback || options)(
          /** @type {NodeJS.ErrnoException | null} */
          err
        );
      }
      (callback || options)(
        null,
        /** @type {ResultOfSyncOrAsyncFunction} */
        result
      );
    };
    this.statSync = /** @type {SyncFileSystem["statSync"]} */
    (arg, options) => fs.statSync(arg, options);
    this.readdir = /** @type {FileSystem["readdir"]} */
    (arg, options, callback) => {
      let result;
      try {
        result = /** @type {SyncOrAsyncFunction | undefined} */
        callback ? fs.readdirSync(
          arg,
          /** @type {Exclude<Parameters<FileSystem["readdir"]>[1], (err: NodeJS.ErrnoException | null, files: string[]) => void>} */
          options
        ) : fs.readdirSync(arg);
      } catch (err) {
        return (callback || options)(
          /** @type {NodeJS.ErrnoException | null} */
          err,
          []
        );
      }
      (callback || options)(
        null,
        /** @type {ResultOfSyncOrAsyncFunction} */
        result
      );
    };
    this.readdirSync = /** @type {SyncFileSystem["readdirSync"]} */
    (arg, options) => fs.readdirSync(
      arg,
      /** @type {Parameters<SyncFileSystem["readdirSync"]>[1]} */
      options
    );
    this.readFile = /** @type {FileSystem["readFile"]} */
    (arg, options, callback) => {
      let result;
      try {
        result = /** @type {SyncOrAsyncFunction | undefined} */
        callback ? fs.readFileSync(arg, options) : fs.readFileSync(arg);
      } catch (err) {
        return (callback || options)(
          /** @type {NodeJS.ErrnoException | null} */
          err
        );
      }
      (callback || options)(
        null,
        /** @type {ResultOfSyncOrAsyncFunction} */
        result
      );
    };
    this.readFileSync = /** @type {SyncFileSystem["readFileSync"]} */
    (arg, options) => fs.readFileSync(arg, options);
    this.readlink = /** @type {FileSystem["readlink"]} */
    (arg, options, callback) => {
      let result;
      try {
        result = /** @type {SyncOrAsyncFunction | undefined} */
        callback ? fs.readlinkSync(
          arg,
          /** @type {Exclude<Parameters<FileSystem["readlink"]>[1], StringCallback>} */
          options
        ) : fs.readlinkSync(arg);
      } catch (err) {
        return (callback || options)(
          /** @type {NodeJS.ErrnoException | null} */
          err
        );
      }
      (callback || options)(
        null,
        /** @type {ResultOfSyncOrAsyncFunction} */
        result
      );
    };
    this.readlinkSync = /** @type {SyncFileSystem["readlinkSync"]} */
    (arg, options) => fs.readlinkSync(
      arg,
      /** @type {Parameters<SyncFileSystem["readlinkSync"]>[1]} */
      options
    );
    this.readJson = void 0;
    this.readJsonSync = void 0;
    const { readJsonSync } = fs;
    if (readJsonSync) {
      this.readJson = /** @type {FileSystem["readJson"]} */
      (arg, callback) => {
        let result;
        try {
          result = readJsonSync.call(fs, arg);
        } catch (err) {
          return callback(
            /** @type {NodeJS.ErrnoException | Error | null} */
            err
          );
        }
        callback(null, result);
      };
      this.readJsonSync = /** @type {SyncFileSystem["readJsonSync"]} */
      (arg) => readJsonSync.call(fs, arg);
    }
    this.realpath = void 0;
    this.realpathSync = void 0;
    const { realpathSync } = fs;
    if (realpathSync) {
      this.realpath = /** @type {FileSystem["realpath"]} */
      (arg, options, callback) => {
        let result;
        try {
          result = /** @type {SyncOrAsyncFunction | undefined} */
          callback ? realpathSync.call(
            fs,
            arg,
            /** @type {Exclude<Parameters<NonNullable<FileSystem["realpath"]>>[1], StringCallback>} */
            options
          ) : realpathSync.call(fs, arg);
        } catch (err) {
          return (callback || options)(
            /** @type {NodeJS.ErrnoException | null} */
            err
          );
        }
        (callback || options)(
          null,
          /** @type {ResultOfSyncOrAsyncFunction} */
          result
        );
      };
      this.realpathSync = /** @type {SyncFileSystem["realpathSync"]} */
      (arg, options) => realpathSync.call(
        fs,
        arg,
        /** @type {Parameters<NonNullable<SyncFileSystem["realpathSync"]>>[1]} */
        options
      );
    }
  }
  __name(SyncAsyncFileSystemDecorator, "SyncAsyncFileSystemDecorator");
  SyncAsyncFileSystemDecorator_1 = SyncAsyncFileSystemDecorator;
  return SyncAsyncFileSystemDecorator_1;
}
__name(requireSyncAsyncFileSystemDecorator, "requireSyncAsyncFileSystemDecorator");
var TryNextPlugin_1;
var hasRequiredTryNextPlugin;
function requireTryNextPlugin() {
  var _a2;
  if (hasRequiredTryNextPlugin) return TryNextPlugin_1;
  hasRequiredTryNextPlugin = 1;
  TryNextPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string} message message
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, message, target) {
      this.source = source;
      this.message = message;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("TryNextPlugin", (request, resolveContext, callback) => {
        resolver2.doResolve(
          target,
          request,
          this.message,
          resolveContext,
          callback
        );
      });
    }
  }, __name(_a2, "TryNextPlugin"), _a2);
  return TryNextPlugin_1;
}
__name(requireTryNextPlugin, "requireTryNextPlugin");
var UnsafeCachePlugin_1;
var hasRequiredUnsafeCachePlugin;
function requireUnsafeCachePlugin() {
  var _a2;
  if (hasRequiredUnsafeCachePlugin) return UnsafeCachePlugin_1;
  hasRequiredUnsafeCachePlugin = 1;
  function getCacheId(type, request, withContext) {
    return JSON.stringify({
      type,
      context: withContext ? request.context : "",
      path: request.path,
      query: request.query,
      fragment: request.fragment,
      request: request.request
    });
  }
  __name(getCacheId, "getCacheId");
  UnsafeCachePlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {(request: ResolveRequest) => boolean} filterPredicate filterPredicate
     * @param {Cache} cache cache
     * @param {boolean} withContext withContext
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, filterPredicate, cache, withContext, target) {
      this.source = source;
      this.filterPredicate = filterPredicate;
      this.withContext = withContext;
      this.cache = cache;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("UnsafeCachePlugin", (request, resolveContext, callback) => {
        if (!this.filterPredicate(request)) return callback();
        const isYield = typeof resolveContext.yield === "function";
        const cacheId = getCacheId(
          isYield ? "yield" : "default",
          request,
          this.withContext
        );
        const cacheEntry = this.cache[cacheId];
        if (cacheEntry) {
          if (isYield) {
            const yield_2 = (
              /** @type {ResolveContextYield} */
              resolveContext.yield
            );
            if (Array.isArray(cacheEntry)) {
              for (const result of cacheEntry) yield_2(result);
            } else {
              yield_2(cacheEntry);
            }
            return callback(null, null);
          }
          return callback(
            null,
            /** @type {ResolveRequest} */
            cacheEntry
          );
        }
        let yieldFn;
        let yield_;
        const yieldResult = [];
        if (isYield) {
          yieldFn = resolveContext.yield;
          yield_ = /* @__PURE__ */ __name((result) => {
            yieldResult.push(result);
          }, "yield_");
        }
        resolver2.doResolve(
          target,
          request,
          null,
          yield_ ? { ...resolveContext, yield: yield_ } : resolveContext,
          (err, result) => {
            if (err) return callback(err);
            if (isYield) {
              if (result) yieldResult.push(result);
              for (const result2 of yieldResult) {
                yieldFn(result2);
              }
              this.cache[cacheId] = yieldResult;
              return callback(null, null);
            }
            if (result) return callback(null, this.cache[cacheId] = result);
            callback();
          }
        );
      });
    }
  }, __name(_a2, "UnsafeCachePlugin"), _a2);
  return UnsafeCachePlugin_1;
}
__name(requireUnsafeCachePlugin, "requireUnsafeCachePlugin");
var UseFilePlugin_1;
var hasRequiredUseFilePlugin;
function requireUseFilePlugin() {
  var _a2;
  if (hasRequiredUseFilePlugin) return UseFilePlugin_1;
  hasRequiredUseFilePlugin = 1;
  UseFilePlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string} filename filename
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, filename, target) {
      this.source = source;
      this.filename = filename;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("UseFilePlugin", (request, resolveContext, callback) => {
        const filePath = resolver2.join(
          /** @type {string} */
          request.path,
          this.filename
        );
        const obj = {
          ...request,
          path: filePath,
          relativePath: request.relativePath && resolver2.join(request.relativePath, this.filename)
        };
        resolver2.doResolve(
          target,
          obj,
          `using path: ${filePath}`,
          resolveContext,
          callback
        );
      });
    }
  }, __name(_a2, "UseFilePlugin"), _a2);
  return UseFilePlugin_1;
}
__name(requireUseFilePlugin, "requireUseFilePlugin");
var hasRequiredResolverFactory;
function requireResolverFactory() {
  if (hasRequiredResolverFactory) return ResolverFactory;
  hasRequiredResolverFactory = 1;
  const { versions } = require$$0;
  const AliasFieldPlugin = requireAliasFieldPlugin();
  const AliasPlugin = requireAliasPlugin();
  const AppendPlugin = requireAppendPlugin();
  const ConditionalPlugin = requireConditionalPlugin();
  const DescriptionFilePlugin = requireDescriptionFilePlugin();
  const DirectoryExistsPlugin = requireDirectoryExistsPlugin();
  const ExportsFieldPlugin = requireExportsFieldPlugin();
  const ExtensionAliasPlugin = requireExtensionAliasPlugin();
  const FileExistsPlugin = requireFileExistsPlugin();
  const ImportsFieldPlugin = requireImportsFieldPlugin();
  const JoinRequestPartPlugin = requireJoinRequestPartPlugin();
  const JoinRequestPlugin = requireJoinRequestPlugin();
  const MainFieldPlugin = requireMainFieldPlugin();
  const ModulesInHierarchicalDirectoriesPlugin = requireModulesInHierarchicalDirectoriesPlugin();
  const ModulesInRootPlugin = requireModulesInRootPlugin();
  const NextPlugin = requireNextPlugin();
  const ParsePlugin = requireParsePlugin();
  const PnpPlugin = requirePnpPlugin();
  const Resolver = requireResolver();
  const RestrictionsPlugin = requireRestrictionsPlugin();
  const ResultPlugin = requireResultPlugin();
  const RootsPlugin = requireRootsPlugin();
  const SelfReferencePlugin = requireSelfReferencePlugin();
  const SymlinkPlugin = requireSymlinkPlugin();
  const SyncAsyncFileSystemDecorator = requireSyncAsyncFileSystemDecorator();
  const TryNextPlugin = requireTryNextPlugin();
  const UnsafeCachePlugin = requireUnsafeCachePlugin();
  const UseFilePlugin = requireUseFilePlugin();
  const { PathType, getType } = requirePath();
  function processPnpApiOption(option) {
    if (option === void 0 && /** @type {NodeJS.ProcessVersions & {pnp: string}} */
    versions.pnp) {
      const _findPnpApi = (
        /** @type {(issuer: string) => PnpApi | null}} */
        // @ts-expect-error maybe nothing
        ce__default.findPnpApi
      );
      if (_findPnpApi) {
        return {
          resolveToUnqualified(request, issuer, opts) {
            const pnpapi = _findPnpApi(issuer);
            if (!pnpapi) {
              return null;
            }
            return pnpapi.resolveToUnqualified(request, issuer, opts);
          }
        };
      }
    }
    return option || null;
  }
  __name(processPnpApiOption, "processPnpApiOption");
  function normalizeAlias(alias) {
    return typeof alias === "object" && !Array.isArray(alias) && alias !== null ? Object.keys(alias).map((key) => {
      const obj = { name: key, onlyModule: false, alias: alias[key] };
      if (/\$$/.test(key)) {
        obj.onlyModule = true;
        obj.name = key.slice(0, -1);
      }
      return obj;
    }) : (
      /** @type {Array<AliasOptionEntry>} */
      alias || []
    );
  }
  __name(normalizeAlias, "normalizeAlias");
  function mergeFilteredToArray(array, filter) {
    const result = [];
    const set = new Set(array);
    for (const item of set) {
      if (filter(item)) {
        const lastElement = result.length > 0 ? result[result.length - 1] : void 0;
        if (Array.isArray(lastElement)) {
          lastElement.push(item);
        } else {
          result.push([item]);
        }
      } else {
        result.push(item);
      }
    }
    return result;
  }
  __name(mergeFilteredToArray, "mergeFilteredToArray");
  function createOptions(options) {
    const mainFieldsSet = new Set(options.mainFields || ["main"]);
    const mainFields = [];
    for (const item of mainFieldsSet) {
      if (typeof item === "string") {
        mainFields.push({
          name: [item],
          forceRelative: true
        });
      } else if (Array.isArray(item)) {
        mainFields.push({
          name: item,
          forceRelative: true
        });
      } else {
        mainFields.push({
          name: Array.isArray(item.name) ? item.name : [item.name],
          forceRelative: item.forceRelative
        });
      }
    }
    return {
      alias: normalizeAlias(options.alias),
      fallback: normalizeAlias(options.fallback),
      aliasFields: new Set(options.aliasFields),
      cachePredicate: options.cachePredicate || /* @__PURE__ */ __name(function trueFn() {
        return true;
      }, "trueFn"),
      cacheWithContext: typeof options.cacheWithContext !== "undefined" ? options.cacheWithContext : true,
      exportsFields: new Set(options.exportsFields || ["exports"]),
      importsFields: new Set(options.importsFields || ["imports"]),
      conditionNames: new Set(options.conditionNames),
      descriptionFiles: [
        ...new Set(options.descriptionFiles || ["package.json"])
      ],
      enforceExtension: options.enforceExtension === void 0 ? Boolean(options.extensions && options.extensions.includes("")) : options.enforceExtension,
      extensions: new Set(options.extensions || [".js", ".json", ".node"]),
      extensionAlias: options.extensionAlias ? Object.keys(options.extensionAlias).map((k2) => ({
        extension: k2,
        alias: (
          /** @type {ExtensionAliasOptions} */
          options.extensionAlias[k2]
        )
      })) : [],
      fileSystem: options.useSyncFileSystemCalls ? new SyncAsyncFileSystemDecorator(
        /** @type {SyncFileSystem} */
        /** @type {unknown} */
        options.fileSystem
      ) : options.fileSystem,
      unsafeCache: options.unsafeCache && typeof options.unsafeCache !== "object" ? (
        /** @type {Cache} */
        {}
      ) : options.unsafeCache || false,
      symlinks: typeof options.symlinks !== "undefined" ? options.symlinks : true,
      resolver: options.resolver,
      modules: mergeFilteredToArray(
        Array.isArray(options.modules) ? options.modules : options.modules ? [options.modules] : ["node_modules"],
        (item) => {
          const type = getType(item);
          return type === PathType.Normal || type === PathType.Relative;
        }
      ),
      mainFields,
      mainFiles: new Set(options.mainFiles || ["index"]),
      plugins: options.plugins || [],
      pnpApi: processPnpApiOption(options.pnpApi),
      roots: new Set(options.roots || void 0),
      fullySpecified: options.fullySpecified || false,
      resolveToContext: options.resolveToContext || false,
      preferRelative: options.preferRelative || false,
      preferAbsolute: options.preferAbsolute || false,
      restrictions: new Set(options.restrictions)
    };
  }
  __name(createOptions, "createOptions");
  ResolverFactory.createResolver = /* @__PURE__ */ __name(function createResolver(options) {
    const normalizedOptions = createOptions(options);
    const {
      alias,
      fallback,
      aliasFields,
      cachePredicate,
      cacheWithContext,
      conditionNames,
      descriptionFiles,
      enforceExtension,
      exportsFields,
      extensionAlias,
      importsFields,
      extensions,
      fileSystem,
      fullySpecified,
      mainFields,
      mainFiles,
      modules,
      plugins: userPlugins,
      pnpApi,
      resolveToContext,
      preferRelative,
      preferAbsolute,
      symlinks,
      unsafeCache,
      resolver: customResolver,
      restrictions,
      roots
    } = normalizedOptions;
    const plugins = [...userPlugins];
    const resolver2 = customResolver || new Resolver(fileSystem, normalizedOptions);
    resolver2.ensureHook("resolve");
    resolver2.ensureHook("internalResolve");
    resolver2.ensureHook("newInternalResolve");
    resolver2.ensureHook("parsedResolve");
    resolver2.ensureHook("describedResolve");
    resolver2.ensureHook("rawResolve");
    resolver2.ensureHook("normalResolve");
    resolver2.ensureHook("internal");
    resolver2.ensureHook("rawModule");
    resolver2.ensureHook("alternateRawModule");
    resolver2.ensureHook("module");
    resolver2.ensureHook("resolveAsModule");
    resolver2.ensureHook("undescribedResolveInPackage");
    resolver2.ensureHook("resolveInPackage");
    resolver2.ensureHook("resolveInExistingDirectory");
    resolver2.ensureHook("relative");
    resolver2.ensureHook("describedRelative");
    resolver2.ensureHook("directory");
    resolver2.ensureHook("undescribedExistingDirectory");
    resolver2.ensureHook("existingDirectory");
    resolver2.ensureHook("undescribedRawFile");
    resolver2.ensureHook("rawFile");
    resolver2.ensureHook("file");
    resolver2.ensureHook("finalFile");
    resolver2.ensureHook("existingFile");
    resolver2.ensureHook("resolved");
    resolver2.hooks.newInteralResolve = resolver2.hooks.newInternalResolve;
    for (const { source, resolveOptions } of [
      { source: "resolve", resolveOptions: { fullySpecified } },
      { source: "internal-resolve", resolveOptions: { fullySpecified: false } }
    ]) {
      if (unsafeCache) {
        plugins.push(
          new UnsafeCachePlugin(
            source,
            cachePredicate,
            /** @type {import("./UnsafeCachePlugin").Cache} */
            unsafeCache,
            cacheWithContext,
            `new-${source}`
          )
        );
        plugins.push(
          new ParsePlugin(`new-${source}`, resolveOptions, "parsed-resolve")
        );
      } else {
        plugins.push(new ParsePlugin(source, resolveOptions, "parsed-resolve"));
      }
    }
    plugins.push(
      new DescriptionFilePlugin(
        "parsed-resolve",
        descriptionFiles,
        false,
        "described-resolve"
      )
    );
    plugins.push(new NextPlugin("after-parsed-resolve", "described-resolve"));
    plugins.push(new NextPlugin("described-resolve", "raw-resolve"));
    if (fallback.length > 0) {
      plugins.push(
        new AliasPlugin("described-resolve", fallback, "internal-resolve")
      );
    }
    if (alias.length > 0) {
      plugins.push(new AliasPlugin("raw-resolve", alias, "internal-resolve"));
    }
    for (const item of aliasFields) {
      plugins.push(new AliasFieldPlugin("raw-resolve", item, "internal-resolve"));
    }
    for (const item of extensionAlias) {
      plugins.push(
        new ExtensionAliasPlugin("raw-resolve", item, "normal-resolve")
      );
    }
    plugins.push(new NextPlugin("raw-resolve", "normal-resolve"));
    if (preferRelative) {
      plugins.push(new JoinRequestPlugin("after-normal-resolve", "relative"));
    }
    plugins.push(
      new ConditionalPlugin(
        "after-normal-resolve",
        { module: true },
        "resolve as module",
        false,
        "raw-module"
      )
    );
    plugins.push(
      new ConditionalPlugin(
        "after-normal-resolve",
        { internal: true },
        "resolve as internal import",
        false,
        "internal"
      )
    );
    if (preferAbsolute) {
      plugins.push(new JoinRequestPlugin("after-normal-resolve", "relative"));
    }
    if (roots.size > 0) {
      plugins.push(new RootsPlugin("after-normal-resolve", roots, "relative"));
    }
    if (!preferRelative && !preferAbsolute) {
      plugins.push(new JoinRequestPlugin("after-normal-resolve", "relative"));
    }
    for (const importsField of importsFields) {
      plugins.push(
        new ImportsFieldPlugin(
          "internal",
          conditionNames,
          importsField,
          "relative",
          "internal-resolve"
        )
      );
    }
    for (const exportsField of exportsFields) {
      plugins.push(
        new SelfReferencePlugin("raw-module", exportsField, "resolve-as-module")
      );
    }
    for (const item of modules) {
      if (Array.isArray(item)) {
        if (item.includes("node_modules") && pnpApi) {
          plugins.push(
            new ModulesInHierarchicalDirectoriesPlugin(
              "raw-module",
              item.filter((i2) => i2 !== "node_modules"),
              "module"
            )
          );
          plugins.push(
            new PnpPlugin(
              "raw-module",
              pnpApi,
              "undescribed-resolve-in-package",
              "alternate-raw-module"
            )
          );
          plugins.push(
            new ModulesInHierarchicalDirectoriesPlugin(
              "alternate-raw-module",
              ["node_modules"],
              "module"
            )
          );
        } else {
          plugins.push(
            new ModulesInHierarchicalDirectoriesPlugin(
              "raw-module",
              item,
              "module"
            )
          );
        }
      } else {
        plugins.push(new ModulesInRootPlugin("raw-module", item, "module"));
      }
    }
    plugins.push(new JoinRequestPartPlugin("module", "resolve-as-module"));
    if (!resolveToContext) {
      plugins.push(
        new ConditionalPlugin(
          "resolve-as-module",
          { directory: false, request: "." },
          "single file module",
          true,
          "undescribed-raw-file"
        )
      );
    }
    plugins.push(
      new DirectoryExistsPlugin(
        "resolve-as-module",
        "undescribed-resolve-in-package"
      )
    );
    plugins.push(
      new DescriptionFilePlugin(
        "undescribed-resolve-in-package",
        descriptionFiles,
        false,
        "resolve-in-package"
      )
    );
    plugins.push(
      new NextPlugin(
        "after-undescribed-resolve-in-package",
        "resolve-in-package"
      )
    );
    for (const exportsField of exportsFields) {
      plugins.push(
        new ExportsFieldPlugin(
          "resolve-in-package",
          conditionNames,
          exportsField,
          "relative"
        )
      );
    }
    plugins.push(
      new NextPlugin("resolve-in-package", "resolve-in-existing-directory")
    );
    plugins.push(
      new JoinRequestPlugin("resolve-in-existing-directory", "relative")
    );
    plugins.push(
      new DescriptionFilePlugin(
        "relative",
        descriptionFiles,
        true,
        "described-relative"
      )
    );
    plugins.push(new NextPlugin("after-relative", "described-relative"));
    if (resolveToContext) {
      plugins.push(new NextPlugin("described-relative", "directory"));
    } else {
      plugins.push(
        new ConditionalPlugin(
          "described-relative",
          { directory: false },
          null,
          true,
          "raw-file"
        )
      );
      plugins.push(
        new ConditionalPlugin(
          "described-relative",
          { fullySpecified: false },
          "as directory",
          true,
          "directory"
        )
      );
    }
    plugins.push(
      new DirectoryExistsPlugin("directory", "undescribed-existing-directory")
    );
    if (resolveToContext) {
      plugins.push(new NextPlugin("undescribed-existing-directory", "resolved"));
    } else {
      plugins.push(
        new DescriptionFilePlugin(
          "undescribed-existing-directory",
          descriptionFiles,
          false,
          "existing-directory"
        )
      );
      for (const item of mainFiles) {
        plugins.push(
          new UseFilePlugin(
            "undescribed-existing-directory",
            item,
            "undescribed-raw-file"
          )
        );
      }
      for (const item of mainFields) {
        plugins.push(
          new MainFieldPlugin(
            "existing-directory",
            item,
            "resolve-in-existing-directory"
          )
        );
      }
      for (const item of mainFiles) {
        plugins.push(
          new UseFilePlugin("existing-directory", item, "undescribed-raw-file")
        );
      }
      plugins.push(
        new DescriptionFilePlugin(
          "undescribed-raw-file",
          descriptionFiles,
          true,
          "raw-file"
        )
      );
      plugins.push(new NextPlugin("after-undescribed-raw-file", "raw-file"));
      plugins.push(
        new ConditionalPlugin(
          "raw-file",
          { fullySpecified: true },
          null,
          false,
          "file"
        )
      );
      if (!enforceExtension) {
        plugins.push(new TryNextPlugin("raw-file", "no extension", "file"));
      }
      for (const item of extensions) {
        plugins.push(new AppendPlugin("raw-file", item, "file"));
      }
      if (alias.length > 0) {
        plugins.push(new AliasPlugin("file", alias, "internal-resolve"));
      }
      for (const item of aliasFields) {
        plugins.push(new AliasFieldPlugin("file", item, "internal-resolve"));
      }
      plugins.push(new NextPlugin("file", "final-file"));
      plugins.push(new FileExistsPlugin("final-file", "existing-file"));
      if (symlinks) {
        plugins.push(new SymlinkPlugin("existing-file", "existing-file"));
      }
      plugins.push(new NextPlugin("existing-file", "resolved"));
    }
    const { resolved } = (
      /** @type {KnownHooks & EnsuredHooks} */
      resolver2.hooks
    );
    if (restrictions.size > 0) {
      plugins.push(new RestrictionsPlugin(resolved, restrictions));
    }
    plugins.push(new ResultPlugin(resolved));
    for (const plugin of plugins) {
      if (typeof plugin === "function") {
        plugin.call(resolver2, resolver2);
      } else if (plugin) {
        plugin.apply(resolver2);
      }
    }
    return resolver2;
  }, "createResolver");
  return ResolverFactory;
}
__name(requireResolverFactory, "requireResolverFactory");
var CloneBasenamePlugin_1;
var hasRequiredCloneBasenamePlugin;
function requireCloneBasenamePlugin() {
  var _a2;
  if (hasRequiredCloneBasenamePlugin) return CloneBasenamePlugin_1;
  hasRequiredCloneBasenamePlugin = 1;
  const { basename } = requireGetPaths();
  CloneBasenamePlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     * @param {string | ResolveStepHook} target target
     */
    constructor(source, target) {
      this.source = source;
      this.target = target;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const target = resolver2.ensureHook(this.target);
      resolver2.getHook(this.source).tapAsync("CloneBasenamePlugin", (request, resolveContext, callback) => {
        const requestPath = (
          /** @type {string} */
          request.path
        );
        const filename = (
          /** @type {string} */
          basename(requestPath)
        );
        const filePath = resolver2.join(requestPath, filename);
        const obj = {
          ...request,
          path: filePath,
          relativePath: request.relativePath && resolver2.join(request.relativePath, filename)
        };
        resolver2.doResolve(
          target,
          obj,
          `using path: ${filePath}`,
          resolveContext,
          callback
        );
      });
    }
  }, __name(_a2, "CloneBasenamePlugin"), _a2);
  return CloneBasenamePlugin_1;
}
__name(requireCloneBasenamePlugin, "requireCloneBasenamePlugin");
var LogInfoPlugin_1;
var hasRequiredLogInfoPlugin;
function requireLogInfoPlugin() {
  var _a2;
  if (hasRequiredLogInfoPlugin) return LogInfoPlugin_1;
  hasRequiredLogInfoPlugin = 1;
  LogInfoPlugin_1 = (_a2 = class {
    /**
     * @param {string | ResolveStepHook} source source
     */
    constructor(source) {
      this.source = source;
    }
    /**
     * @param {Resolver} resolver the resolver
     * @returns {void}
     */
    apply(resolver2) {
      const { source } = this;
      resolver2.getHook(this.source).tapAsync("LogInfoPlugin", (request, resolveContext, callback) => {
        if (!resolveContext.log) return callback();
        const { log } = resolveContext;
        const prefix = `[${source}] `;
        if (request.path) {
          log(`${prefix}Resolving in directory: ${request.path}`);
        }
        if (request.request) {
          log(`${prefix}Resolving request: ${request.request}`);
        }
        if (request.module) log(`${prefix}Request is an module request.`);
        if (request.directory) log(`${prefix}Request is a directory request.`);
        if (request.query) {
          log(`${prefix}Resolving request query: ${request.query}`);
        }
        if (request.fragment) {
          log(`${prefix}Resolving request fragment: ${request.fragment}`);
        }
        if (request.descriptionFilePath) {
          log(
            `${prefix}Has description data from ${request.descriptionFilePath}`
          );
        }
        if (request.relativePath) {
          log(
            `${prefix}Relative path from description file is: ${request.relativePath}`
          );
        }
        callback();
      });
    }
  }, __name(_a2, "LogInfoPlugin"), _a2);
  return LogInfoPlugin_1;
}
__name(requireLogInfoPlugin, "requireLogInfoPlugin");
const memoize = memoize_1;
const getCachedFileSystem = memoize(() => requireCachedInputFileSystem());
const getNodeFileSystem = memoize(() => {
  const fs = requireGracefulFs();
  const CachedInputFileSystem = getCachedFileSystem();
  return new CachedInputFileSystem(fs, 4e3);
});
const getNodeContext = memoize(() => ({
  environments: ["node+es3+es5+process+native"]
}));
const getResolverFactory = memoize(() => requireResolverFactory());
const getAsyncResolver = memoize(
  () => getResolverFactory().createResolver({
    conditionNames: ["node"],
    extensions: [".js", ".json", ".node"],
    fileSystem: getNodeFileSystem()
  })
);
const resolve$1 = (
  /**
   * @param {object | string} context context
   * @param {string} path path
   * @param {string | ResolveContext | ResolveCallback} request request
   * @param {ResolveContext | ResolveCallback=} resolveContext resolve context
   * @param {ResolveCallback=} callback callback
   */
  /* @__PURE__ */ __name((context, path2, request, resolveContext, callback) => {
    if (typeof context === "string") {
      callback = /** @type {ResolveCallback} */
      resolveContext;
      resolveContext = /** @type {ResolveContext} */
      request;
      request = path2;
      path2 = context;
      context = getNodeContext();
    }
    if (typeof callback !== "function") {
      callback = /** @type {ResolveCallback} */
      resolveContext;
    }
    getAsyncResolver().resolve(
      context,
      path2,
      /** @type {string} */
      request,
      /** @type {ResolveContext} */
      resolveContext,
      /** @type {ResolveCallback} */
      callback
    );
  }, "resolve$1")
);
const getSyncResolver = memoize(
  () => getResolverFactory().createResolver({
    conditionNames: ["node"],
    extensions: [".js", ".json", ".node"],
    useSyncFileSystemCalls: true,
    fileSystem: getNodeFileSystem()
  })
);
const resolveSync = (
  /**
   * @param {object|string} context context
   * @param {string} path path
   * @param {string=} request request
   * @returns {string | false} result
   */
  /* @__PURE__ */ __name((context, path2, request) => {
    if (typeof context === "string") {
      request = path2;
      path2 = context;
      context = getNodeContext();
    }
    return getSyncResolver().resolveSync(
      context,
      path2,
      /** @type {string} */
      request
    );
  }, "resolveSync")
);
function create(options) {
  const resolver2 = getResolverFactory().createResolver({
    fileSystem: getNodeFileSystem(),
    ...options
  });
  return /* @__PURE__ */ __name(function create2(context, path2, request, resolveContext, callback) {
    if (typeof context === "string") {
      callback = /** @type {ResolveCallback} */
      resolveContext;
      resolveContext = /** @type {ResolveContext} */
      request;
      request = path2;
      path2 = context;
      context = getNodeContext();
    }
    if (typeof callback !== "function") {
      callback = /** @type {ResolveCallback} */
      resolveContext;
    }
    resolver2.resolve(
      context,
      path2,
      /** @type {string} */
      request,
      /** @type {ResolveContext} */
      resolveContext,
      callback
    );
  }, "create");
}
__name(create, "create");
function createSync(options) {
  const resolver2 = getResolverFactory().createResolver({
    useSyncFileSystemCalls: true,
    fileSystem: getNodeFileSystem(),
    ...options
  });
  return /* @__PURE__ */ __name(function createSync2(context, path2, request) {
    if (typeof context === "string") {
      request = path2;
      path2 = context;
      context = getNodeContext();
    }
    return resolver2.resolveSync(
      context,
      path2,
      /** @type {string} */
      request
    );
  }, "createSync");
}
__name(createSync, "createSync");
const mergeExports = /* @__PURE__ */ __name((obj, exports) => {
  const descriptors = Object.getOwnPropertyDescriptors(exports);
  Object.defineProperties(obj, descriptors);
  return (
    /** @type {A & B} */
    Object.freeze(obj)
  );
}, "mergeExports");
var lib = mergeExports(resolve$1, {
  get sync() {
    return resolveSync;
  },
  create: mergeExports(create, {
    get sync() {
      return createSync;
    }
  }),
  get ResolverFactory() {
    return getResolverFactory();
  },
  get CachedInputFileSystem() {
    return getCachedFileSystem();
  },
  get CloneBasenamePlugin() {
    return requireCloneBasenamePlugin();
  },
  get LogInfoPlugin() {
    return requireLogInfoPlugin();
  },
  get forEachBail() {
    return requireForEachBail();
  }
});
const F$1 = /* @__PURE__ */ getDefaultExportFromCjs(lib);
var jiti = { exports: {} };
(() => {
  var e = { "./node_modules/.pnpm/mlly@1.8.0/node_modules/mlly/dist lazy recursive": /* @__PURE__ */ __name(function(e2) {
    function webpackEmptyAsyncContext(e3) {
      return Promise.resolve().then(function() {
        var t2 = new Error("Cannot find module '" + e3 + "'");
        throw t2.code = "MODULE_NOT_FOUND", t2;
      });
    }
    __name(webpackEmptyAsyncContext, "webpackEmptyAsyncContext");
    webpackEmptyAsyncContext.keys = () => [], webpackEmptyAsyncContext.resolve = webpackEmptyAsyncContext, webpackEmptyAsyncContext.id = "./node_modules/.pnpm/mlly@1.8.0/node_modules/mlly/dist lazy recursive", e2.exports = webpackEmptyAsyncContext;
  }, "./node_modules/.pnpm/mlly@1.8.0/node_modules/mlly/dist lazy recursive") }, t = {};
  function __webpack_require__(i3) {
    var s = t[i3];
    if (void 0 !== s) return s.exports;
    var r = t[i3] = { exports: {} };
    return e[i3](r, r.exports, __webpack_require__), r.exports;
  }
  __name(__webpack_require__, "__webpack_require__");
  __webpack_require__.n = (e2) => {
    var t2 = e2 && e2.__esModule ? () => e2.default : () => e2;
    return __webpack_require__.d(t2, { a: t2 }), t2;
  }, __webpack_require__.d = (e2, t2) => {
    for (var i3 in t2) __webpack_require__.o(t2, i3) && !__webpack_require__.o(e2, i3) && Object.defineProperty(e2, i3, { enumerable: true, get: t2[i3] });
  }, __webpack_require__.o = (e2, t2) => Object.prototype.hasOwnProperty.call(e2, t2);
  var i2 = {};
  (() => {
    var _a2, _b2, _c2, _d2, _e5, _f2, _g2, _h2, _i2, _j2, _k2, _l2, _m;
    __webpack_require__.d(i2, { default: /* @__PURE__ */ __name(() => createJiti2, "default") });
    const e2 = require$$0$4;
    var t2 = [509, 0, 227, 0, 150, 4, 294, 9, 1368, 2, 2, 1, 6, 3, 41, 2, 5, 0, 166, 1, 574, 3, 9, 9, 7, 9, 32, 4, 318, 1, 80, 3, 71, 10, 50, 3, 123, 2, 54, 14, 32, 10, 3, 1, 11, 3, 46, 10, 8, 0, 46, 9, 7, 2, 37, 13, 2, 9, 6, 1, 45, 0, 13, 2, 49, 13, 9, 3, 2, 11, 83, 11, 7, 0, 3, 0, 158, 11, 6, 9, 7, 3, 56, 1, 2, 6, 3, 1, 3, 2, 10, 0, 11, 1, 3, 6, 4, 4, 68, 8, 2, 0, 3, 0, 2, 3, 2, 4, 2, 0, 15, 1, 83, 17, 10, 9, 5, 0, 82, 19, 13, 9, 214, 6, 3, 8, 28, 1, 83, 16, 16, 9, 82, 12, 9, 9, 7, 19, 58, 14, 5, 9, 243, 14, 166, 9, 71, 5, 2, 1, 3, 3, 2, 0, 2, 1, 13, 9, 120, 6, 3, 6, 4, 0, 29, 9, 41, 6, 2, 3, 9, 0, 10, 10, 47, 15, 343, 9, 54, 7, 2, 7, 17, 9, 57, 21, 2, 13, 123, 5, 4, 0, 2, 1, 2, 6, 2, 0, 9, 9, 49, 4, 2, 1, 2, 4, 9, 9, 330, 3, 10, 1, 2, 0, 49, 6, 4, 4, 14, 10, 5350, 0, 7, 14, 11465, 27, 2343, 9, 87, 9, 39, 4, 60, 6, 26, 9, 535, 9, 470, 0, 2, 54, 8, 3, 82, 0, 12, 1, 19628, 1, 4178, 9, 519, 45, 3, 22, 543, 4, 4, 5, 9, 7, 3, 6, 31, 3, 149, 2, 1418, 49, 513, 54, 5, 49, 9, 0, 15, 0, 23, 4, 2, 14, 1361, 6, 2, 16, 3, 6, 2, 1, 2, 4, 101, 0, 161, 6, 10, 9, 357, 0, 62, 13, 499, 13, 245, 1, 2, 9, 726, 6, 110, 6, 6, 9, 4759, 9, 787719, 239], s = [0, 11, 2, 25, 2, 18, 2, 1, 2, 14, 3, 13, 35, 122, 70, 52, 268, 28, 4, 48, 48, 31, 14, 29, 6, 37, 11, 29, 3, 35, 5, 7, 2, 4, 43, 157, 19, 35, 5, 35, 5, 39, 9, 51, 13, 10, 2, 14, 2, 6, 2, 1, 2, 10, 2, 14, 2, 6, 2, 1, 4, 51, 13, 310, 10, 21, 11, 7, 25, 5, 2, 41, 2, 8, 70, 5, 3, 0, 2, 43, 2, 1, 4, 0, 3, 22, 11, 22, 10, 30, 66, 18, 2, 1, 11, 21, 11, 25, 71, 55, 7, 1, 65, 0, 16, 3, 2, 2, 2, 28, 43, 28, 4, 28, 36, 7, 2, 27, 28, 53, 11, 21, 11, 18, 14, 17, 111, 72, 56, 50, 14, 50, 14, 35, 39, 27, 10, 22, 251, 41, 7, 1, 17, 2, 60, 28, 11, 0, 9, 21, 43, 17, 47, 20, 28, 22, 13, 52, 58, 1, 3, 0, 14, 44, 33, 24, 27, 35, 30, 0, 3, 0, 9, 34, 4, 0, 13, 47, 15, 3, 22, 0, 2, 0, 36, 17, 2, 24, 20, 1, 64, 6, 2, 0, 2, 3, 2, 14, 2, 9, 8, 46, 39, 7, 3, 1, 3, 21, 2, 6, 2, 1, 2, 4, 4, 0, 19, 0, 13, 4, 31, 9, 2, 0, 3, 0, 2, 37, 2, 0, 26, 0, 2, 0, 45, 52, 19, 3, 21, 2, 31, 47, 21, 1, 2, 0, 185, 46, 42, 3, 37, 47, 21, 0, 60, 42, 14, 0, 72, 26, 38, 6, 186, 43, 117, 63, 32, 7, 3, 0, 3, 7, 2, 1, 2, 23, 16, 0, 2, 0, 95, 7, 3, 38, 17, 0, 2, 0, 29, 0, 11, 39, 8, 0, 22, 0, 12, 45, 20, 0, 19, 72, 200, 32, 32, 8, 2, 36, 18, 0, 50, 29, 113, 6, 2, 1, 2, 37, 22, 0, 26, 5, 2, 1, 2, 31, 15, 0, 328, 18, 16, 0, 2, 12, 2, 33, 125, 0, 80, 921, 103, 110, 18, 195, 2637, 96, 16, 1071, 18, 5, 26, 3994, 6, 582, 6842, 29, 1763, 568, 8, 30, 18, 78, 18, 29, 19, 47, 17, 3, 32, 20, 6, 18, 433, 44, 212, 63, 129, 74, 6, 0, 67, 12, 65, 1, 2, 0, 29, 6135, 9, 1237, 42, 9, 8936, 3, 2, 6, 2, 1, 2, 290, 16, 0, 30, 2, 3, 0, 15, 3, 9, 395, 2309, 106, 6, 12, 4, 8, 8, 9, 5991, 84, 2, 70, 2, 1, 3, 0, 3, 1, 3, 3, 2, 11, 2, 0, 2, 6, 2, 64, 2, 3, 3, 7, 2, 6, 2, 27, 2, 3, 2, 4, 2, 0, 4, 6, 2, 339, 3, 24, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 30, 2, 24, 2, 7, 1845, 30, 7, 5, 262, 61, 147, 44, 11, 6, 17, 0, 322, 29, 19, 43, 485, 27, 229, 29, 3, 0, 496, 6, 2, 3, 2, 1, 2, 14, 2, 196, 60, 67, 8, 0, 1205, 3, 2, 26, 2, 1, 2, 0, 3, 0, 2, 9, 2, 3, 2, 0, 2, 0, 7, 0, 5, 0, 2, 0, 2, 0, 2, 2, 2, 1, 2, 0, 3, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 1, 2, 0, 3, 3, 2, 6, 2, 3, 2, 3, 2, 0, 2, 9, 2, 16, 6, 2, 2, 4, 2, 16, 4421, 42719, 33, 4153, 7, 221, 3, 5761, 15, 7472, 16, 621, 2467, 541, 1507, 4938, 6, 4191], r = "ªµºÀ-ÖØ-öø-ˁˆ-ˑˠ-ˤˬˮͰ-ʹͶͷͺ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՙՠ-ֈא-תׯ-ײؠ-يٮٯٱ-ۓەۥۦۮۯۺ-ۼۿܐܒ-ܯݍ-ޥޱߊ-ߪߴߵߺࠀ-ࠕࠚࠤࠨࡀ-ࡘࡠ-ࡪࡰ-ࢇࢉ-ࢎࢠ-ࣉऄ-हऽॐक़-ॡॱ-ঀঅ-ঌএঐও-নপ-রলশ-হঽৎড়ঢ়য়-ৡৰৱৼਅ-ਊਏਐਓ-ਨਪ-ਰਲਲ਼ਵਸ਼ਸਹਖ਼-ੜਫ਼ੲ-ੴઅ-ઍએ-ઑઓ-નપ-રલળવ-હઽૐૠૡૹଅ-ଌଏଐଓ-ନପ-ରଲଳଵ-ହଽଡ଼ଢ଼ୟ-ୡୱஃஅ-ஊஎ-ஐஒ-கஙசஜஞடணதந-பம-ஹௐఅ-ఌఎ-ఐఒ-నప-హఽౘ-ౚౝౠౡಀಅ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹಽೝೞೠೡೱೲഄ-ഌഎ-ഐഒ-ഺഽൎൔ-ൖൟ-ൡൺ-ൿඅ-ඖක-නඳ-රලව-ෆก-ะาำเ-ๆກຂຄຆ-ຊຌ-ຣລວ-ະາຳຽເ-ໄໆໜ-ໟༀཀ-ཇཉ-ཬྈ-ྌက-ဪဿၐ-ၕၚ-ၝၡၥၦၮ-ၰၵ-ႁႎႠ-ჅჇჍა-ჺჼ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚᎀ-ᎏᎠ-Ᏽᏸ-ᏽᐁ-ᙬᙯ-ᙿᚁ-ᚚᚠ-ᛪᛮ-ᛸᜀ-ᜑᜟ-ᜱᝀ-ᝑᝠ-ᝬᝮ-ᝰក-ឳៗៜᠠ-ᡸᢀ-ᢨᢪᢰ-ᣵᤀ-ᤞᥐ-ᥭᥰ-ᥴᦀ-ᦫᦰ-ᧉᨀ-ᨖᨠ-ᩔᪧᬅ-ᬳᭅ-ᭌᮃ-ᮠᮮᮯᮺ-ᯥᰀ-ᰣᱍ-ᱏᱚ-ᱽᲀ-ᲊᲐ-ᲺᲽ-Ჿᳩ-ᳬᳮ-ᳳᳵᳶᳺᴀ-ᶿḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼⁱⁿₐ-ₜℂℇℊ-ℓℕ℘-ℝℤΩℨK-ℹℼ-ℿⅅ-ⅉⅎⅠ-ↈⰀ-ⳤⳫ-ⳮⳲⳳⴀ-ⴥⴧⴭⴰ-ⵧⵯⶀ-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞ々-〇〡-〩〱-〵〸-〼ぁ-ゖ゛-ゟァ-ヺー-ヿㄅ-ㄯㄱ-ㆎㆠ-ㆿㇰ-ㇿ㐀-䶿一-ꒌꓐ-ꓽꔀ-ꘌꘐ-ꘟꘪꘫꙀ-ꙮꙿ-ꚝꚠ-ꛯꜗ-ꜟꜢ-ꞈꞋ-ꟍꟐꟑꟓꟕ-Ƛꟲ-ꠁꠃ-ꠅꠇ-ꠊꠌ-ꠢꡀ-ꡳꢂ-ꢳꣲ-ꣷꣻꣽꣾꤊ-ꤥꤰ-ꥆꥠ-ꥼꦄ-ꦲꧏꧠ-ꧤꧦ-ꧯꧺ-ꧾꨀ-ꨨꩀ-ꩂꩄ-ꩋꩠ-ꩶꩺꩾ-ꪯꪱꪵꪶꪹ-ꪽꫀꫂꫛ-ꫝꫠ-ꫪꫲ-ꫴꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮꬰ-ꭚꭜ-ꭩꭰ-ꯢ가-힣ힰ-ퟆퟋ-ퟻ豈-舘並-龎ﬀ-ﬆﬓ-ﬗיִײַ-ﬨשׁ-זּטּ-לּמּנּסּףּפּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼＡ-Ｚａ-ｚｦ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ", n2 = { 3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile", 5: "class enum extends super const export import", 6: "enum", strict: "implements interface let package private protected public static yield", strictBind: "eval arguments" }, a2 = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this", o = { 5: a2, "5module": a2 + " export import", 6: a2 + " const class extends export import super" }, h2 = /^in(stanceof)?$/, c2 = new RegExp("[" + r + "]"), p = new RegExp("[" + r + "‌‍·̀-ͯ·҃-֑҇-ׇֽֿׁׂׅׄؐ-ًؚ-٩ٰۖ-ۜ۟-۪ۤۧۨ-ۭ۰-۹ܑܰ-݊ަ-ް߀-߉߫-߽߳ࠖ-࠙ࠛ-ࠣࠥ-ࠧࠩ-࡙࠭-࡛ࢗ-࢟࣊-ࣣ࣡-ःऺ-़ा-ॏ॑-ॗॢॣ०-९ঁ-ঃ়া-ৄেৈো-্ৗৢৣ০-৯৾ਁ-ਃ਼ਾ-ੂੇੈੋ-੍ੑ੦-ੱੵઁ-ઃ઼ા-ૅે-ૉો-્ૢૣ૦-૯ૺ-૿ଁ-ଃ଼ା-ୄେୈୋ-୍୕-ୗୢୣ୦-୯ஂா-ூெ-ைொ-்ௗ௦-௯ఀ-ఄ఼ా-ౄె-ైొ-్ౕౖౢౣ౦-౯ಁ-ಃ಼ಾ-ೄೆ-ೈೊ-್ೕೖೢೣ೦-೯ೳഀ-ഃ഻഼ാ-ൄെ-ൈൊ-്ൗൢൣ൦-൯ඁ-ඃ්ා-ුූෘ-ෟ෦-෯ෲෳัิ-ฺ็-๎๐-๙ັິ-ຼ່-໎໐-໙༘༙༠-༩༹༵༷༾༿ཱ-྄྆྇ྍ-ྗྙ-ྼ࿆ါ-ှ၀-၉ၖ-ၙၞ-ၠၢ-ၤၧ-ၭၱ-ၴႂ-ႍႏ-ႝ፝-፟፩-፱ᜒ-᜕ᜲ-᜴ᝒᝓᝲᝳ឴-៓៝០-៩᠋-᠍᠏-᠙ᢩᤠ-ᤫᤰ-᤻᥆-᥏᧐-᧚ᨗ-ᨛᩕ-ᩞ᩠-᩿᩼-᪉᪐-᪙᪰-᪽ᪿ-ᫎᬀ-ᬄ᬴-᭄᭐-᭙᭫-᭳ᮀ-ᮂᮡ-ᮭ᮰-᮹᯦-᯳ᰤ-᰷᱀-᱉᱐-᱙᳐-᳔᳒-᳨᳭᳴᳷-᳹᷀-᷿‌‍‿⁀⁔⃐-⃥⃜⃡-⃰⳯-⵿⳱ⷠ-〪ⷿ-゙゚〯・꘠-꘩꙯ꙴ-꙽ꚞꚟ꛰꛱ꠂ꠆ꠋꠣ-ꠧ꠬ꢀꢁꢴ-ꣅ꣐-꣙꣠-꣱ꣿ-꤉ꤦ-꤭ꥇ-꥓ꦀ-ꦃ꦳-꧀꧐-꧙ꧥ꧰-꧹ꨩ-ꨶꩃꩌꩍ꩐-꩙ꩻ-ꩽꪰꪲ-ꪴꪷꪸꪾ꪿꫁ꫫ-ꫯꫵ꫶ꯣ-ꯪ꯬꯭꯰-꯹ﬞ︀-️︠-︯︳︴﹍-﹏０-９＿･]");
    function isInAstralSet(e3, t3) {
      for (var i3 = 65536, s2 = 0; s2 < t3.length; s2 += 2) {
        if ((i3 += t3[s2]) > e3) return false;
        if ((i3 += t3[s2 + 1]) >= e3) return true;
      }
      return false;
    }
    __name(isInAstralSet, "isInAstralSet");
    function isIdentifierStart(e3, t3) {
      return e3 < 65 ? 36 === e3 : e3 < 91 || (e3 < 97 ? 95 === e3 : e3 < 123 || (e3 <= 65535 ? e3 >= 170 && c2.test(String.fromCharCode(e3)) : false !== t3 && isInAstralSet(e3, s)));
    }
    __name(isIdentifierStart, "isIdentifierStart");
    function isIdentifierChar(e3, i3) {
      return e3 < 48 ? 36 === e3 : e3 < 58 || !(e3 < 65) && (e3 < 91 || (e3 < 97 ? 95 === e3 : e3 < 123 || (e3 <= 65535 ? e3 >= 170 && p.test(String.fromCharCode(e3)) : false !== i3 && (isInAstralSet(e3, s) || isInAstralSet(e3, t2)))));
    }
    __name(isIdentifierChar, "isIdentifierChar");
    var acorn_TokenType = /* @__PURE__ */ __name(function(e3, t3) {
      void 0 === t3 && (t3 = {}), this.label = e3, this.keyword = t3.keyword, this.beforeExpr = !!t3.beforeExpr, this.startsExpr = !!t3.startsExpr, this.isLoop = !!t3.isLoop, this.isAssign = !!t3.isAssign, this.prefix = !!t3.prefix, this.postfix = !!t3.postfix, this.binop = t3.binop || null, this.updateContext = null;
    }, "acorn_TokenType");
    function binop(e3, t3) {
      return new acorn_TokenType(e3, { beforeExpr: true, binop: t3 });
    }
    __name(binop, "binop");
    var l2 = { beforeExpr: true }, u2 = { startsExpr: true }, d2 = {};
    function kw(e3, t3) {
      return void 0 === t3 && (t3 = {}), t3.keyword = e3, d2[e3] = new acorn_TokenType(e3, t3);
    }
    __name(kw, "kw");
    var f2 = { num: new acorn_TokenType("num", u2), regexp: new acorn_TokenType("regexp", u2), string: new acorn_TokenType("string", u2), name: new acorn_TokenType("name", u2), privateId: new acorn_TokenType("privateId", u2), eof: new acorn_TokenType("eof"), bracketL: new acorn_TokenType("[", { beforeExpr: true, startsExpr: true }), bracketR: new acorn_TokenType("]"), braceL: new acorn_TokenType("{", { beforeExpr: true, startsExpr: true }), braceR: new acorn_TokenType("}"), parenL: new acorn_TokenType("(", { beforeExpr: true, startsExpr: true }), parenR: new acorn_TokenType(")"), comma: new acorn_TokenType(",", l2), semi: new acorn_TokenType(";", l2), colon: new acorn_TokenType(":", l2), dot: new acorn_TokenType("."), question: new acorn_TokenType("?", l2), questionDot: new acorn_TokenType("?."), arrow: new acorn_TokenType("=>", l2), template: new acorn_TokenType("template"), invalidTemplate: new acorn_TokenType("invalidTemplate"), ellipsis: new acorn_TokenType("...", l2), backQuote: new acorn_TokenType("`", u2), dollarBraceL: new acorn_TokenType("${", { beforeExpr: true, startsExpr: true }), eq: new acorn_TokenType("=", { beforeExpr: true, isAssign: true }), assign: new acorn_TokenType("_=", { beforeExpr: true, isAssign: true }), incDec: new acorn_TokenType("++/--", { prefix: true, postfix: true, startsExpr: true }), prefix: new acorn_TokenType("!/~", { beforeExpr: true, prefix: true, startsExpr: true }), logicalOR: binop("||", 1), logicalAND: binop("&&", 2), bitwiseOR: binop("|", 3), bitwiseXOR: binop("^", 4), bitwiseAND: binop("&", 5), equality: binop("==/!=/===/!==", 6), relational: binop("</>/<=/>=", 7), bitShift: binop("<</>>/>>>", 8), plusMin: new acorn_TokenType("+/-", { beforeExpr: true, binop: 9, prefix: true, startsExpr: true }), modulo: binop("%", 10), star: binop("*", 10), slash: binop("/", 10), starstar: new acorn_TokenType("**", { beforeExpr: true }), coalesce: binop("??", 1), _break: kw("break"), _case: kw("case", l2), _catch: kw("catch"), _continue: kw("continue"), _debugger: kw("debugger"), _default: kw("default", l2), _do: kw("do", { isLoop: true, beforeExpr: true }), _else: kw("else", l2), _finally: kw("finally"), _for: kw("for", { isLoop: true }), _function: kw("function", u2), _if: kw("if"), _return: kw("return", l2), _switch: kw("switch"), _throw: kw("throw", l2), _try: kw("try"), _var: kw("var"), _const: kw("const"), _while: kw("while", { isLoop: true }), _with: kw("with"), _new: kw("new", { beforeExpr: true, startsExpr: true }), _this: kw("this", u2), _super: kw("super", u2), _class: kw("class", u2), _extends: kw("extends", l2), _export: kw("export"), _import: kw("import", u2), _null: kw("null", u2), _true: kw("true", u2), _false: kw("false", u2), _in: kw("in", { beforeExpr: true, binop: 7 }), _instanceof: kw("instanceof", { beforeExpr: true, binop: 7 }), _typeof: kw("typeof", { beforeExpr: true, prefix: true, startsExpr: true }), _void: kw("void", { beforeExpr: true, prefix: true, startsExpr: true }), _delete: kw("delete", { beforeExpr: true, prefix: true, startsExpr: true }) }, m = /\r\n?|\n|\u2028|\u2029/, g2 = new RegExp(m.source, "g");
    function isNewLine(e3) {
      return 10 === e3 || 13 === e3 || 8232 === e3 || 8233 === e3;
    }
    __name(isNewLine, "isNewLine");
    function nextLineBreak(e3, t3, i3) {
      void 0 === i3 && (i3 = e3.length);
      for (var s2 = t3; s2 < i3; s2++) {
        var r2 = e3.charCodeAt(s2);
        if (isNewLine(r2)) return s2 < i3 - 1 && 13 === r2 && 10 === e3.charCodeAt(s2 + 1) ? s2 + 2 : s2 + 1;
      }
      return -1;
    }
    __name(nextLineBreak, "nextLineBreak");
    var x2 = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/, v2 = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g, y2 = Object.prototype, _ = y2.hasOwnProperty, E2 = y2.toString, b = Object.hasOwn || function(e3, t3) {
      return _.call(e3, t3);
    }, S2 = Array.isArray || function(e3) {
      return "[object Array]" === E2.call(e3);
    }, k2 = /* @__PURE__ */ Object.create(null);
    function wordsRegexp(e3) {
      return k2[e3] || (k2[e3] = new RegExp("^(?:" + e3.replace(/ /g, "|") + ")$"));
    }
    __name(wordsRegexp, "wordsRegexp");
    function codePointToString(e3) {
      return e3 <= 65535 ? String.fromCharCode(e3) : (e3 -= 65536, String.fromCharCode(55296 + (e3 >> 10), 56320 + (1023 & e3)));
    }
    __name(codePointToString, "codePointToString");
    var w2 = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF])/, acorn_Position = /* @__PURE__ */ __name(function(e3, t3) {
      this.line = e3, this.column = t3;
    }, "acorn_Position");
    acorn_Position.prototype.offset = function(e3) {
      return new acorn_Position(this.line, this.column + e3);
    };
    var acorn_SourceLocation = /* @__PURE__ */ __name(function(e3, t3, i3) {
      this.start = t3, this.end = i3, null !== e3.sourceFile && (this.source = e3.sourceFile);
    }, "acorn_SourceLocation");
    function getLineInfo(e3, t3) {
      for (var i3 = 1, s2 = 0; ; ) {
        var r2 = nextLineBreak(e3, s2, t3);
        if (r2 < 0) return new acorn_Position(i3, t3 - s2);
        ++i3, s2 = r2;
      }
    }
    __name(getLineInfo, "getLineInfo");
    var I = { ecmaVersion: null, sourceType: "script", onInsertedSemicolon: null, onTrailingComma: null, allowReserved: null, allowReturnOutsideFunction: false, allowImportExportEverywhere: false, allowAwaitOutsideFunction: null, allowSuperOutsideMethod: null, allowHashBang: false, checkPrivateFields: true, locations: false, onToken: null, onComment: null, ranges: false, program: null, sourceFile: null, directSourceFile: null, preserveParens: false }, C = false;
    function getOptions(e3) {
      var t3 = {};
      for (var i3 in I) t3[i3] = e3 && b(e3, i3) ? e3[i3] : I[i3];
      if ("latest" === t3.ecmaVersion ? t3.ecmaVersion = 1e8 : null == t3.ecmaVersion ? (!C && "object" == typeof console && console.warn && (C = true, console.warn("Since Acorn 8.0.0, options.ecmaVersion is required.\nDefaulting to 2020, but this will stop working in the future.")), t3.ecmaVersion = 11) : t3.ecmaVersion >= 2015 && (t3.ecmaVersion -= 2009), null == t3.allowReserved && (t3.allowReserved = t3.ecmaVersion < 5), e3 && null != e3.allowHashBang || (t3.allowHashBang = t3.ecmaVersion >= 14), S2(t3.onToken)) {
        var s2 = t3.onToken;
        t3.onToken = function(e4) {
          return s2.push(e4);
        };
      }
      return S2(t3.onComment) && (t3.onComment = /* @__PURE__ */ function(e4, t4) {
        return function(i4, s3, r2, n3, a3, o2) {
          var h3 = { type: i4 ? "Block" : "Line", value: s3, start: r2, end: n3 };
          e4.locations && (h3.loc = new acorn_SourceLocation(this, a3, o2)), e4.ranges && (h3.range = [r2, n3]), t4.push(h3);
        };
      }(t3, t3.onComment)), t3;
    }
    __name(getOptions, "getOptions");
    var R = 256, P2 = 259;
    function functionFlags(e3, t3) {
      return 2 | (e3 ? 4 : 0) | (t3 ? 8 : 0);
    }
    __name(functionFlags, "functionFlags");
    var acorn_Parser = /* @__PURE__ */ __name(function(e3, t3, i3) {
      this.options = e3 = getOptions(e3), this.sourceFile = e3.sourceFile, this.keywords = wordsRegexp(o[e3.ecmaVersion >= 6 ? 6 : "module" === e3.sourceType ? "5module" : 5]);
      var s2 = "";
      true !== e3.allowReserved && (s2 = n2[e3.ecmaVersion >= 6 ? 6 : 5 === e3.ecmaVersion ? 5 : 3], "module" === e3.sourceType && (s2 += " await")), this.reservedWords = wordsRegexp(s2);
      var r2 = (s2 ? s2 + " " : "") + n2.strict;
      this.reservedWordsStrict = wordsRegexp(r2), this.reservedWordsStrictBind = wordsRegexp(r2 + " " + n2.strictBind), this.input = String(t3), this.containsEsc = false, i3 ? (this.pos = i3, this.lineStart = this.input.lastIndexOf("\n", i3 - 1) + 1, this.curLine = this.input.slice(0, this.lineStart).split(m).length) : (this.pos = this.lineStart = 0, this.curLine = 1), this.type = f2.eof, this.value = null, this.start = this.end = this.pos, this.startLoc = this.endLoc = this.curPosition(), this.lastTokEndLoc = this.lastTokStartLoc = null, this.lastTokStart = this.lastTokEnd = this.pos, this.context = this.initialContext(), this.exprAllowed = true, this.inModule = "module" === e3.sourceType, this.strict = this.inModule || this.strictDirective(this.pos), this.potentialArrowAt = -1, this.potentialArrowInForAwait = false, this.yieldPos = this.awaitPos = this.awaitIdentPos = 0, this.labels = [], this.undefinedExports = /* @__PURE__ */ Object.create(null), 0 === this.pos && e3.allowHashBang && "#!" === this.input.slice(0, 2) && this.skipLineComment(2), this.scopeStack = [], this.enterScope(1), this.regexpState = null, this.privateNameStack = [];
    }, "acorn_Parser"), T2 = { inFunction: { configurable: true }, inGenerator: { configurable: true }, inAsync: { configurable: true }, canAwait: { configurable: true }, allowSuper: { configurable: true }, allowDirectSuper: { configurable: true }, treatFunctionsAsVar: { configurable: true }, allowNewDotTarget: { configurable: true }, inClassStaticBlock: { configurable: true } };
    acorn_Parser.prototype.parse = function() {
      var e3 = this.options.program || this.startNode();
      return this.nextToken(), this.parseTopLevel(e3);
    }, T2.inFunction.get = function() {
      return (2 & this.currentVarScope().flags) > 0;
    }, T2.inGenerator.get = function() {
      return (8 & this.currentVarScope().flags) > 0;
    }, T2.inAsync.get = function() {
      return (4 & this.currentVarScope().flags) > 0;
    }, T2.canAwait.get = function() {
      for (var e3 = this.scopeStack.length - 1; e3 >= 0; e3--) {
        var t3 = this.scopeStack[e3].flags;
        if (768 & t3) return false;
        if (2 & t3) return (4 & t3) > 0;
      }
      return this.inModule && this.options.ecmaVersion >= 13 || this.options.allowAwaitOutsideFunction;
    }, T2.allowSuper.get = function() {
      return (64 & this.currentThisScope().flags) > 0 || this.options.allowSuperOutsideMethod;
    }, T2.allowDirectSuper.get = function() {
      return (128 & this.currentThisScope().flags) > 0;
    }, T2.treatFunctionsAsVar.get = function() {
      return this.treatFunctionsAsVarInScope(this.currentScope());
    }, T2.allowNewDotTarget.get = function() {
      for (var e3 = this.scopeStack.length - 1; e3 >= 0; e3--) {
        var t3 = this.scopeStack[e3].flags;
        if (768 & t3 || 2 & t3 && !(16 & t3)) return true;
      }
      return false;
    }, T2.inClassStaticBlock.get = function() {
      return (this.currentVarScope().flags & R) > 0;
    }, acorn_Parser.extend = function() {
      for (var e3 = [], t3 = arguments.length; t3--; ) e3[t3] = arguments[t3];
      for (var i3 = this, s2 = 0; s2 < e3.length; s2++) i3 = e3[s2](i3);
      return i3;
    }, acorn_Parser.parse = function(e3, t3) {
      return new this(t3, e3).parse();
    }, acorn_Parser.parseExpressionAt = function(e3, t3, i3) {
      var s2 = new this(i3, e3, t3);
      return s2.nextToken(), s2.parseExpression();
    }, acorn_Parser.tokenizer = function(e3, t3) {
      return new this(t3, e3);
    }, Object.defineProperties(acorn_Parser.prototype, T2);
    var A2 = acorn_Parser.prototype, N = /^(?:'((?:\\[^]|[^'\\])*?)'|"((?:\\[^]|[^"\\])*?)")/;
    A2.strictDirective = function(e3) {
      if (this.options.ecmaVersion < 5) return false;
      for (; ; ) {
        v2.lastIndex = e3, e3 += v2.exec(this.input)[0].length;
        var t3 = N.exec(this.input.slice(e3));
        if (!t3) return false;
        if ("use strict" === (t3[1] || t3[2])) {
          v2.lastIndex = e3 + t3[0].length;
          var i3 = v2.exec(this.input), s2 = i3.index + i3[0].length, r2 = this.input.charAt(s2);
          return ";" === r2 || "}" === r2 || m.test(i3[0]) && !(/[(`.[+\-/*%<>=,?^&]/.test(r2) || "!" === r2 && "=" === this.input.charAt(s2 + 1));
        }
        e3 += t3[0].length, v2.lastIndex = e3, e3 += v2.exec(this.input)[0].length, ";" === this.input[e3] && e3++;
      }
    }, A2.eat = function(e3) {
      return this.type === e3 && (this.next(), true);
    }, A2.isContextual = function(e3) {
      return this.type === f2.name && this.value === e3 && !this.containsEsc;
    }, A2.eatContextual = function(e3) {
      return !!this.isContextual(e3) && (this.next(), true);
    }, A2.expectContextual = function(e3) {
      this.eatContextual(e3) || this.unexpected();
    }, A2.canInsertSemicolon = function() {
      return this.type === f2.eof || this.type === f2.braceR || m.test(this.input.slice(this.lastTokEnd, this.start));
    }, A2.insertSemicolon = function() {
      if (this.canInsertSemicolon()) return this.options.onInsertedSemicolon && this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc), true;
    }, A2.semicolon = function() {
      this.eat(f2.semi) || this.insertSemicolon() || this.unexpected();
    }, A2.afterTrailingComma = function(e3, t3) {
      if (this.type === e3) return this.options.onTrailingComma && this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc), t3 || this.next(), true;
    }, A2.expect = function(e3) {
      this.eat(e3) || this.unexpected();
    }, A2.unexpected = function(e3) {
      this.raise(null != e3 ? e3 : this.start, "Unexpected token");
    };
    var acorn_DestructuringErrors = /* @__PURE__ */ __name(function() {
      this.shorthandAssign = this.trailingComma = this.parenthesizedAssign = this.parenthesizedBind = this.doubleProto = -1;
    }, "acorn_DestructuringErrors");
    A2.checkPatternErrors = function(e3, t3) {
      if (e3) {
        e3.trailingComma > -1 && this.raiseRecoverable(e3.trailingComma, "Comma is not permitted after the rest element");
        var i3 = t3 ? e3.parenthesizedAssign : e3.parenthesizedBind;
        i3 > -1 && this.raiseRecoverable(i3, t3 ? "Assigning to rvalue" : "Parenthesized pattern");
      }
    }, A2.checkExpressionErrors = function(e3, t3) {
      if (!e3) return false;
      var i3 = e3.shorthandAssign, s2 = e3.doubleProto;
      if (!t3) return i3 >= 0 || s2 >= 0;
      i3 >= 0 && this.raise(i3, "Shorthand property assignments are valid only in destructuring patterns"), s2 >= 0 && this.raiseRecoverable(s2, "Redefinition of __proto__ property");
    }, A2.checkYieldAwaitInDefaultParams = function() {
      this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos) && this.raise(this.yieldPos, "Yield expression cannot be a default value"), this.awaitPos && this.raise(this.awaitPos, "Await expression cannot be a default value");
    }, A2.isSimpleAssignTarget = function(e3) {
      return "ParenthesizedExpression" === e3.type ? this.isSimpleAssignTarget(e3.expression) : "Identifier" === e3.type || "MemberExpression" === e3.type;
    };
    var L2 = acorn_Parser.prototype;
    L2.parseTopLevel = function(e3) {
      var t3 = /* @__PURE__ */ Object.create(null);
      for (e3.body || (e3.body = []); this.type !== f2.eof; ) {
        var i3 = this.parseStatement(null, true, t3);
        e3.body.push(i3);
      }
      if (this.inModule) for (var s2 = 0, r2 = Object.keys(this.undefinedExports); s2 < r2.length; s2 += 1) {
        var n3 = r2[s2];
        this.raiseRecoverable(this.undefinedExports[n3].start, "Export '" + n3 + "' is not defined");
      }
      return this.adaptDirectivePrologue(e3.body), this.next(), e3.sourceType = this.options.sourceType, this.finishNode(e3, "Program");
    };
    var O2 = { kind: "loop" }, D2 = { kind: "switch" };
    L2.isLet = function(e3) {
      if (this.options.ecmaVersion < 6 || !this.isContextual("let")) return false;
      v2.lastIndex = this.pos;
      var t3 = v2.exec(this.input), i3 = this.pos + t3[0].length, s2 = this.input.charCodeAt(i3);
      if (91 === s2 || 92 === s2) return true;
      if (e3) return false;
      if (123 === s2 || s2 > 55295 && s2 < 56320) return true;
      if (isIdentifierStart(s2, true)) {
        for (var r2 = i3 + 1; isIdentifierChar(s2 = this.input.charCodeAt(r2), true); ) ++r2;
        if (92 === s2 || s2 > 55295 && s2 < 56320) return true;
        var n3 = this.input.slice(i3, r2);
        if (!h2.test(n3)) return true;
      }
      return false;
    }, L2.isAsyncFunction = function() {
      if (this.options.ecmaVersion < 8 || !this.isContextual("async")) return false;
      v2.lastIndex = this.pos;
      var e3, t3 = v2.exec(this.input), i3 = this.pos + t3[0].length;
      return !(m.test(this.input.slice(this.pos, i3)) || "function" !== this.input.slice(i3, i3 + 8) || i3 + 8 !== this.input.length && (isIdentifierChar(e3 = this.input.charCodeAt(i3 + 8)) || e3 > 55295 && e3 < 56320));
    }, L2.isUsingKeyword = function(e3, t3) {
      if (this.options.ecmaVersion < 17 || !this.isContextual(e3 ? "await" : "using")) return false;
      v2.lastIndex = this.pos;
      var i3 = v2.exec(this.input), s2 = this.pos + i3[0].length;
      if (m.test(this.input.slice(this.pos, s2))) return false;
      if (e3) {
        var r2, n3 = s2 + 5;
        if ("using" !== this.input.slice(s2, n3) || n3 === this.input.length || isIdentifierChar(r2 = this.input.charCodeAt(n3)) || r2 > 55295 && r2 < 56320) return false;
        v2.lastIndex = n3;
        var a3 = v2.exec(this.input);
        if (a3 && m.test(this.input.slice(n3, n3 + a3[0].length))) return false;
      }
      if (t3) {
        var o2, h3 = s2 + 2;
        if (!("of" !== this.input.slice(s2, h3) || h3 !== this.input.length && (isIdentifierChar(o2 = this.input.charCodeAt(h3)) || o2 > 55295 && o2 < 56320))) return false;
      }
      var c3 = this.input.charCodeAt(s2);
      return isIdentifierStart(c3, true) || 92 === c3;
    }, L2.isAwaitUsing = function(e3) {
      return this.isUsingKeyword(true, e3);
    }, L2.isUsing = function(e3) {
      return this.isUsingKeyword(false, e3);
    }, L2.parseStatement = function(e3, t3, i3) {
      var s2, r2 = this.type, n3 = this.startNode();
      switch (this.isLet(e3) && (r2 = f2._var, s2 = "let"), r2) {
        case f2._break:
        case f2._continue:
          return this.parseBreakContinueStatement(n3, r2.keyword);
        case f2._debugger:
          return this.parseDebuggerStatement(n3);
        case f2._do:
          return this.parseDoStatement(n3);
        case f2._for:
          return this.parseForStatement(n3);
        case f2._function:
          return e3 && (this.strict || "if" !== e3 && "label" !== e3) && this.options.ecmaVersion >= 6 && this.unexpected(), this.parseFunctionStatement(n3, false, !e3);
        case f2._class:
          return e3 && this.unexpected(), this.parseClass(n3, true);
        case f2._if:
          return this.parseIfStatement(n3);
        case f2._return:
          return this.parseReturnStatement(n3);
        case f2._switch:
          return this.parseSwitchStatement(n3);
        case f2._throw:
          return this.parseThrowStatement(n3);
        case f2._try:
          return this.parseTryStatement(n3);
        case f2._const:
        case f2._var:
          return s2 = s2 || this.value, e3 && "var" !== s2 && this.unexpected(), this.parseVarStatement(n3, s2);
        case f2._while:
          return this.parseWhileStatement(n3);
        case f2._with:
          return this.parseWithStatement(n3);
        case f2.braceL:
          return this.parseBlock(true, n3);
        case f2.semi:
          return this.parseEmptyStatement(n3);
        case f2._export:
        case f2._import:
          if (this.options.ecmaVersion > 10 && r2 === f2._import) {
            v2.lastIndex = this.pos;
            var a3 = v2.exec(this.input), o2 = this.pos + a3[0].length, h3 = this.input.charCodeAt(o2);
            if (40 === h3 || 46 === h3) return this.parseExpressionStatement(n3, this.parseExpression());
          }
          return this.options.allowImportExportEverywhere || (t3 || this.raise(this.start, "'import' and 'export' may only appear at the top level"), this.inModule || this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'")), r2 === f2._import ? this.parseImport(n3) : this.parseExport(n3, i3);
        default:
          if (this.isAsyncFunction()) return e3 && this.unexpected(), this.next(), this.parseFunctionStatement(n3, true, !e3);
          var c3 = this.isAwaitUsing(false) ? "await using" : this.isUsing(false) ? "using" : null;
          if (c3) return t3 && "script" === this.options.sourceType && this.raise(this.start, "Using declaration cannot appear in the top level when source type is `script`"), "await using" === c3 && (this.canAwait || this.raise(this.start, "Await using cannot appear outside of async function"), this.next()), this.next(), this.parseVar(n3, false, c3), this.semicolon(), this.finishNode(n3, "VariableDeclaration");
          var p2 = this.value, l3 = this.parseExpression();
          return r2 === f2.name && "Identifier" === l3.type && this.eat(f2.colon) ? this.parseLabeledStatement(n3, p2, l3, e3) : this.parseExpressionStatement(n3, l3);
      }
    }, L2.parseBreakContinueStatement = function(e3, t3) {
      var i3 = "break" === t3;
      this.next(), this.eat(f2.semi) || this.insertSemicolon() ? e3.label = null : this.type !== f2.name ? this.unexpected() : (e3.label = this.parseIdent(), this.semicolon());
      for (var s2 = 0; s2 < this.labels.length; ++s2) {
        var r2 = this.labels[s2];
        if (null == e3.label || r2.name === e3.label.name) {
          if (null != r2.kind && (i3 || "loop" === r2.kind)) break;
          if (e3.label && i3) break;
        }
      }
      return s2 === this.labels.length && this.raise(e3.start, "Unsyntactic " + t3), this.finishNode(e3, i3 ? "BreakStatement" : "ContinueStatement");
    }, L2.parseDebuggerStatement = function(e3) {
      return this.next(), this.semicolon(), this.finishNode(e3, "DebuggerStatement");
    }, L2.parseDoStatement = function(e3) {
      return this.next(), this.labels.push(O2), e3.body = this.parseStatement("do"), this.labels.pop(), this.expect(f2._while), e3.test = this.parseParenExpression(), this.options.ecmaVersion >= 6 ? this.eat(f2.semi) : this.semicolon(), this.finishNode(e3, "DoWhileStatement");
    }, L2.parseForStatement = function(e3) {
      this.next();
      var t3 = this.options.ecmaVersion >= 9 && this.canAwait && this.eatContextual("await") ? this.lastTokStart : -1;
      if (this.labels.push(O2), this.enterScope(0), this.expect(f2.parenL), this.type === f2.semi) return t3 > -1 && this.unexpected(t3), this.parseFor(e3, null);
      var i3 = this.isLet();
      if (this.type === f2._var || this.type === f2._const || i3) {
        var s2 = this.startNode(), r2 = i3 ? "let" : this.value;
        return this.next(), this.parseVar(s2, true, r2), this.finishNode(s2, "VariableDeclaration"), this.parseForAfterInit(e3, s2, t3);
      }
      var n3 = this.isContextual("let"), a3 = false, o2 = this.isUsing(true) ? "using" : this.isAwaitUsing(true) ? "await using" : null;
      if (o2) {
        var h3 = this.startNode();
        return this.next(), "await using" === o2 && this.next(), this.parseVar(h3, true, o2), this.finishNode(h3, "VariableDeclaration"), this.parseForAfterInit(e3, h3, t3);
      }
      var c3 = this.containsEsc, p2 = new acorn_DestructuringErrors(), l3 = this.start, u3 = t3 > -1 ? this.parseExprSubscripts(p2, "await") : this.parseExpression(true, p2);
      return this.type === f2._in || (a3 = this.options.ecmaVersion >= 6 && this.isContextual("of")) ? (t3 > -1 ? (this.type === f2._in && this.unexpected(t3), e3.await = true) : a3 && this.options.ecmaVersion >= 8 && (u3.start !== l3 || c3 || "Identifier" !== u3.type || "async" !== u3.name ? this.options.ecmaVersion >= 9 && (e3.await = false) : this.unexpected()), n3 && a3 && this.raise(u3.start, "The left-hand side of a for-of loop may not start with 'let'."), this.toAssignable(u3, false, p2), this.checkLValPattern(u3), this.parseForIn(e3, u3)) : (this.checkExpressionErrors(p2, true), t3 > -1 && this.unexpected(t3), this.parseFor(e3, u3));
    }, L2.parseForAfterInit = function(e3, t3, i3) {
      return (this.type === f2._in || this.options.ecmaVersion >= 6 && this.isContextual("of")) && 1 === t3.declarations.length ? (this.options.ecmaVersion >= 9 && (this.type === f2._in ? i3 > -1 && this.unexpected(i3) : e3.await = i3 > -1), this.parseForIn(e3, t3)) : (i3 > -1 && this.unexpected(i3), this.parseFor(e3, t3));
    }, L2.parseFunctionStatement = function(e3, t3, i3) {
      return this.next(), this.parseFunction(e3, U | (i3 ? 0 : M2), false, t3);
    }, L2.parseIfStatement = function(e3) {
      return this.next(), e3.test = this.parseParenExpression(), e3.consequent = this.parseStatement("if"), e3.alternate = this.eat(f2._else) ? this.parseStatement("if") : null, this.finishNode(e3, "IfStatement");
    }, L2.parseReturnStatement = function(e3) {
      return this.inFunction || this.options.allowReturnOutsideFunction || this.raise(this.start, "'return' outside of function"), this.next(), this.eat(f2.semi) || this.insertSemicolon() ? e3.argument = null : (e3.argument = this.parseExpression(), this.semicolon()), this.finishNode(e3, "ReturnStatement");
    }, L2.parseSwitchStatement = function(e3) {
      var t3;
      this.next(), e3.discriminant = this.parseParenExpression(), e3.cases = [], this.expect(f2.braceL), this.labels.push(D2), this.enterScope(0);
      for (var i3 = false; this.type !== f2.braceR; ) if (this.type === f2._case || this.type === f2._default) {
        var s2 = this.type === f2._case;
        t3 && this.finishNode(t3, "SwitchCase"), e3.cases.push(t3 = this.startNode()), t3.consequent = [], this.next(), s2 ? t3.test = this.parseExpression() : (i3 && this.raiseRecoverable(this.lastTokStart, "Multiple default clauses"), i3 = true, t3.test = null), this.expect(f2.colon);
      } else t3 || this.unexpected(), t3.consequent.push(this.parseStatement(null));
      return this.exitScope(), t3 && this.finishNode(t3, "SwitchCase"), this.next(), this.labels.pop(), this.finishNode(e3, "SwitchStatement");
    }, L2.parseThrowStatement = function(e3) {
      return this.next(), m.test(this.input.slice(this.lastTokEnd, this.start)) && this.raise(this.lastTokEnd, "Illegal newline after throw"), e3.argument = this.parseExpression(), this.semicolon(), this.finishNode(e3, "ThrowStatement");
    };
    var V2 = [];
    L2.parseCatchClauseParam = function() {
      var e3 = this.parseBindingAtom(), t3 = "Identifier" === e3.type;
      return this.enterScope(t3 ? 32 : 0), this.checkLValPattern(e3, t3 ? 4 : 2), this.expect(f2.parenR), e3;
    }, L2.parseTryStatement = function(e3) {
      if (this.next(), e3.block = this.parseBlock(), e3.handler = null, this.type === f2._catch) {
        var t3 = this.startNode();
        this.next(), this.eat(f2.parenL) ? t3.param = this.parseCatchClauseParam() : (this.options.ecmaVersion < 10 && this.unexpected(), t3.param = null, this.enterScope(0)), t3.body = this.parseBlock(false), this.exitScope(), e3.handler = this.finishNode(t3, "CatchClause");
      }
      return e3.finalizer = this.eat(f2._finally) ? this.parseBlock() : null, e3.handler || e3.finalizer || this.raise(e3.start, "Missing catch or finally clause"), this.finishNode(e3, "TryStatement");
    }, L2.parseVarStatement = function(e3, t3, i3) {
      return this.next(), this.parseVar(e3, false, t3, i3), this.semicolon(), this.finishNode(e3, "VariableDeclaration");
    }, L2.parseWhileStatement = function(e3) {
      return this.next(), e3.test = this.parseParenExpression(), this.labels.push(O2), e3.body = this.parseStatement("while"), this.labels.pop(), this.finishNode(e3, "WhileStatement");
    }, L2.parseWithStatement = function(e3) {
      return this.strict && this.raise(this.start, "'with' in strict mode"), this.next(), e3.object = this.parseParenExpression(), e3.body = this.parseStatement("with"), this.finishNode(e3, "WithStatement");
    }, L2.parseEmptyStatement = function(e3) {
      return this.next(), this.finishNode(e3, "EmptyStatement");
    }, L2.parseLabeledStatement = function(e3, t3, i3, s2) {
      for (var r2 = 0, n3 = this.labels; r2 < n3.length; r2 += 1) {
        n3[r2].name === t3 && this.raise(i3.start, "Label '" + t3 + "' is already declared");
      }
      for (var a3 = this.type.isLoop ? "loop" : this.type === f2._switch ? "switch" : null, o2 = this.labels.length - 1; o2 >= 0; o2--) {
        var h3 = this.labels[o2];
        if (h3.statementStart !== e3.start) break;
        h3.statementStart = this.start, h3.kind = a3;
      }
      return this.labels.push({ name: t3, kind: a3, statementStart: this.start }), e3.body = this.parseStatement(s2 ? -1 === s2.indexOf("label") ? s2 + "label" : s2 : "label"), this.labels.pop(), e3.label = i3, this.finishNode(e3, "LabeledStatement");
    }, L2.parseExpressionStatement = function(e3, t3) {
      return e3.expression = t3, this.semicolon(), this.finishNode(e3, "ExpressionStatement");
    }, L2.parseBlock = function(e3, t3, i3) {
      for (void 0 === e3 && (e3 = true), void 0 === t3 && (t3 = this.startNode()), t3.body = [], this.expect(f2.braceL), e3 && this.enterScope(0); this.type !== f2.braceR; ) {
        var s2 = this.parseStatement(null);
        t3.body.push(s2);
      }
      return i3 && (this.strict = false), this.next(), e3 && this.exitScope(), this.finishNode(t3, "BlockStatement");
    }, L2.parseFor = function(e3, t3) {
      return e3.init = t3, this.expect(f2.semi), e3.test = this.type === f2.semi ? null : this.parseExpression(), this.expect(f2.semi), e3.update = this.type === f2.parenR ? null : this.parseExpression(), this.expect(f2.parenR), e3.body = this.parseStatement("for"), this.exitScope(), this.labels.pop(), this.finishNode(e3, "ForStatement");
    }, L2.parseForIn = function(e3, t3) {
      var i3 = this.type === f2._in;
      return this.next(), "VariableDeclaration" === t3.type && null != t3.declarations[0].init && (!i3 || this.options.ecmaVersion < 8 || this.strict || "var" !== t3.kind || "Identifier" !== t3.declarations[0].id.type) && this.raise(t3.start, (i3 ? "for-in" : "for-of") + " loop variable declaration may not have an initializer"), e3.left = t3, e3.right = i3 ? this.parseExpression() : this.parseMaybeAssign(), this.expect(f2.parenR), e3.body = this.parseStatement("for"), this.exitScope(), this.labels.pop(), this.finishNode(e3, i3 ? "ForInStatement" : "ForOfStatement");
    }, L2.parseVar = function(e3, t3, i3, s2) {
      for (e3.declarations = [], e3.kind = i3; ; ) {
        var r2 = this.startNode();
        if (this.parseVarId(r2, i3), this.eat(f2.eq) ? r2.init = this.parseMaybeAssign(t3) : s2 || "const" !== i3 || this.type === f2._in || this.options.ecmaVersion >= 6 && this.isContextual("of") ? s2 || "using" !== i3 && "await using" !== i3 || !(this.options.ecmaVersion >= 17) || this.type === f2._in || this.isContextual("of") ? s2 || "Identifier" === r2.id.type || t3 && (this.type === f2._in || this.isContextual("of")) ? r2.init = null : this.raise(this.lastTokEnd, "Complex binding patterns require an initialization value") : this.raise(this.lastTokEnd, "Missing initializer in " + i3 + " declaration") : this.unexpected(), e3.declarations.push(this.finishNode(r2, "VariableDeclarator")), !this.eat(f2.comma)) break;
      }
      return e3;
    }, L2.parseVarId = function(e3, t3) {
      e3.id = "using" === t3 || "await using" === t3 ? this.parseIdent() : this.parseBindingAtom(), this.checkLValPattern(e3.id, "var" === t3 ? 1 : 2, false);
    };
    var U = 1, M2 = 2;
    function isPrivateNameConflicted(e3, t3) {
      var i3 = t3.key.name, s2 = e3[i3], r2 = "true";
      return "MethodDefinition" !== t3.type || "get" !== t3.kind && "set" !== t3.kind || (r2 = (t3.static ? "s" : "i") + t3.kind), "iget" === s2 && "iset" === r2 || "iset" === s2 && "iget" === r2 || "sget" === s2 && "sset" === r2 || "sset" === s2 && "sget" === r2 ? (e3[i3] = "true", false) : !!s2 || (e3[i3] = r2, false);
    }
    __name(isPrivateNameConflicted, "isPrivateNameConflicted");
    function checkKeyName(e3, t3) {
      var i3 = e3.computed, s2 = e3.key;
      return !i3 && ("Identifier" === s2.type && s2.name === t3 || "Literal" === s2.type && s2.value === t3);
    }
    __name(checkKeyName, "checkKeyName");
    L2.parseFunction = function(e3, t3, i3, s2, r2) {
      this.initFunction(e3), (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !s2) && (this.type === f2.star && t3 & M2 && this.unexpected(), e3.generator = this.eat(f2.star)), this.options.ecmaVersion >= 8 && (e3.async = !!s2), t3 & U && (e3.id = 4 & t3 && this.type !== f2.name ? null : this.parseIdent(), !e3.id || t3 & M2 || this.checkLValSimple(e3.id, this.strict || e3.generator || e3.async ? this.treatFunctionsAsVar ? 1 : 2 : 3));
      var n3 = this.yieldPos, a3 = this.awaitPos, o2 = this.awaitIdentPos;
      return this.yieldPos = 0, this.awaitPos = 0, this.awaitIdentPos = 0, this.enterScope(functionFlags(e3.async, e3.generator)), t3 & U || (e3.id = this.type === f2.name ? this.parseIdent() : null), this.parseFunctionParams(e3), this.parseFunctionBody(e3, i3, false, r2), this.yieldPos = n3, this.awaitPos = a3, this.awaitIdentPos = o2, this.finishNode(e3, t3 & U ? "FunctionDeclaration" : "FunctionExpression");
    }, L2.parseFunctionParams = function(e3) {
      this.expect(f2.parenL), e3.params = this.parseBindingList(f2.parenR, false, this.options.ecmaVersion >= 8), this.checkYieldAwaitInDefaultParams();
    }, L2.parseClass = function(e3, t3) {
      this.next();
      var i3 = this.strict;
      this.strict = true, this.parseClassId(e3, t3), this.parseClassSuper(e3);
      var s2 = this.enterClassBody(), r2 = this.startNode(), n3 = false;
      for (r2.body = [], this.expect(f2.braceL); this.type !== f2.braceR; ) {
        var a3 = this.parseClassElement(null !== e3.superClass);
        a3 && (r2.body.push(a3), "MethodDefinition" === a3.type && "constructor" === a3.kind ? (n3 && this.raiseRecoverable(a3.start, "Duplicate constructor in the same class"), n3 = true) : a3.key && "PrivateIdentifier" === a3.key.type && isPrivateNameConflicted(s2, a3) && this.raiseRecoverable(a3.key.start, "Identifier '#" + a3.key.name + "' has already been declared"));
      }
      return this.strict = i3, this.next(), e3.body = this.finishNode(r2, "ClassBody"), this.exitClassBody(), this.finishNode(e3, t3 ? "ClassDeclaration" : "ClassExpression");
    }, L2.parseClassElement = function(e3) {
      if (this.eat(f2.semi)) return null;
      var t3 = this.options.ecmaVersion, i3 = this.startNode(), s2 = "", r2 = false, n3 = false, a3 = "method", o2 = false;
      if (this.eatContextual("static")) {
        if (t3 >= 13 && this.eat(f2.braceL)) return this.parseClassStaticBlock(i3), i3;
        this.isClassElementNameStart() || this.type === f2.star ? o2 = true : s2 = "static";
      }
      if (i3.static = o2, !s2 && t3 >= 8 && this.eatContextual("async") && (!this.isClassElementNameStart() && this.type !== f2.star || this.canInsertSemicolon() ? s2 = "async" : n3 = true), !s2 && (t3 >= 9 || !n3) && this.eat(f2.star) && (r2 = true), !s2 && !n3 && !r2) {
        var h3 = this.value;
        (this.eatContextual("get") || this.eatContextual("set")) && (this.isClassElementNameStart() ? a3 = h3 : s2 = h3);
      }
      if (s2 ? (i3.computed = false, i3.key = this.startNodeAt(this.lastTokStart, this.lastTokStartLoc), i3.key.name = s2, this.finishNode(i3.key, "Identifier")) : this.parseClassElementName(i3), t3 < 13 || this.type === f2.parenL || "method" !== a3 || r2 || n3) {
        var c3 = !i3.static && checkKeyName(i3, "constructor"), p2 = c3 && e3;
        c3 && "method" !== a3 && this.raise(i3.key.start, "Constructor can't have get/set modifier"), i3.kind = c3 ? "constructor" : a3, this.parseClassMethod(i3, r2, n3, p2);
      } else this.parseClassField(i3);
      return i3;
    }, L2.isClassElementNameStart = function() {
      return this.type === f2.name || this.type === f2.privateId || this.type === f2.num || this.type === f2.string || this.type === f2.bracketL || this.type.keyword;
    }, L2.parseClassElementName = function(e3) {
      this.type === f2.privateId ? ("constructor" === this.value && this.raise(this.start, "Classes can't have an element named '#constructor'"), e3.computed = false, e3.key = this.parsePrivateIdent()) : this.parsePropertyName(e3);
    }, L2.parseClassMethod = function(e3, t3, i3, s2) {
      var r2 = e3.key;
      "constructor" === e3.kind ? (t3 && this.raise(r2.start, "Constructor can't be a generator"), i3 && this.raise(r2.start, "Constructor can't be an async method")) : e3.static && checkKeyName(e3, "prototype") && this.raise(r2.start, "Classes may not have a static property named prototype");
      var n3 = e3.value = this.parseMethod(t3, i3, s2);
      return "get" === e3.kind && 0 !== n3.params.length && this.raiseRecoverable(n3.start, "getter should have no params"), "set" === e3.kind && 1 !== n3.params.length && this.raiseRecoverable(n3.start, "setter should have exactly one param"), "set" === e3.kind && "RestElement" === n3.params[0].type && this.raiseRecoverable(n3.params[0].start, "Setter cannot use rest params"), this.finishNode(e3, "MethodDefinition");
    }, L2.parseClassField = function(e3) {
      return checkKeyName(e3, "constructor") ? this.raise(e3.key.start, "Classes can't have a field named 'constructor'") : e3.static && checkKeyName(e3, "prototype") && this.raise(e3.key.start, "Classes can't have a static field named 'prototype'"), this.eat(f2.eq) ? (this.enterScope(576), e3.value = this.parseMaybeAssign(), this.exitScope()) : e3.value = null, this.semicolon(), this.finishNode(e3, "PropertyDefinition");
    }, L2.parseClassStaticBlock = function(e3) {
      e3.body = [];
      var t3 = this.labels;
      for (this.labels = [], this.enterScope(320); this.type !== f2.braceR; ) {
        var i3 = this.parseStatement(null);
        e3.body.push(i3);
      }
      return this.next(), this.exitScope(), this.labels = t3, this.finishNode(e3, "StaticBlock");
    }, L2.parseClassId = function(e3, t3) {
      this.type === f2.name ? (e3.id = this.parseIdent(), t3 && this.checkLValSimple(e3.id, 2, false)) : (true === t3 && this.unexpected(), e3.id = null);
    }, L2.parseClassSuper = function(e3) {
      e3.superClass = this.eat(f2._extends) ? this.parseExprSubscripts(null, false) : null;
    }, L2.enterClassBody = function() {
      var e3 = { declared: /* @__PURE__ */ Object.create(null), used: [] };
      return this.privateNameStack.push(e3), e3.declared;
    }, L2.exitClassBody = function() {
      var e3 = this.privateNameStack.pop(), t3 = e3.declared, i3 = e3.used;
      if (this.options.checkPrivateFields) for (var s2 = this.privateNameStack.length, r2 = 0 === s2 ? null : this.privateNameStack[s2 - 1], n3 = 0; n3 < i3.length; ++n3) {
        var a3 = i3[n3];
        b(t3, a3.name) || (r2 ? r2.used.push(a3) : this.raiseRecoverable(a3.start, "Private field '#" + a3.name + "' must be declared in an enclosing class"));
      }
    }, L2.parseExportAllDeclaration = function(e3, t3) {
      return this.options.ecmaVersion >= 11 && (this.eatContextual("as") ? (e3.exported = this.parseModuleExportName(), this.checkExport(t3, e3.exported, this.lastTokStart)) : e3.exported = null), this.expectContextual("from"), this.type !== f2.string && this.unexpected(), e3.source = this.parseExprAtom(), this.options.ecmaVersion >= 16 && (e3.attributes = this.parseWithClause()), this.semicolon(), this.finishNode(e3, "ExportAllDeclaration");
    }, L2.parseExport = function(e3, t3) {
      if (this.next(), this.eat(f2.star)) return this.parseExportAllDeclaration(e3, t3);
      if (this.eat(f2._default)) return this.checkExport(t3, "default", this.lastTokStart), e3.declaration = this.parseExportDefaultDeclaration(), this.finishNode(e3, "ExportDefaultDeclaration");
      if (this.shouldParseExportStatement()) e3.declaration = this.parseExportDeclaration(e3), "VariableDeclaration" === e3.declaration.type ? this.checkVariableExport(t3, e3.declaration.declarations) : this.checkExport(t3, e3.declaration.id, e3.declaration.id.start), e3.specifiers = [], e3.source = null, this.options.ecmaVersion >= 16 && (e3.attributes = []);
      else {
        if (e3.declaration = null, e3.specifiers = this.parseExportSpecifiers(t3), this.eatContextual("from")) this.type !== f2.string && this.unexpected(), e3.source = this.parseExprAtom(), this.options.ecmaVersion >= 16 && (e3.attributes = this.parseWithClause());
        else {
          for (var i3 = 0, s2 = e3.specifiers; i3 < s2.length; i3 += 1) {
            var r2 = s2[i3];
            this.checkUnreserved(r2.local), this.checkLocalExport(r2.local), "Literal" === r2.local.type && this.raise(r2.local.start, "A string literal cannot be used as an exported binding without `from`.");
          }
          e3.source = null, this.options.ecmaVersion >= 16 && (e3.attributes = []);
        }
        this.semicolon();
      }
      return this.finishNode(e3, "ExportNamedDeclaration");
    }, L2.parseExportDeclaration = function(e3) {
      return this.parseStatement(null);
    }, L2.parseExportDefaultDeclaration = function() {
      var e3;
      if (this.type === f2._function || (e3 = this.isAsyncFunction())) {
        var t3 = this.startNode();
        return this.next(), e3 && this.next(), this.parseFunction(t3, 4 | U, false, e3);
      }
      if (this.type === f2._class) {
        var i3 = this.startNode();
        return this.parseClass(i3, "nullableID");
      }
      var s2 = this.parseMaybeAssign();
      return this.semicolon(), s2;
    }, L2.checkExport = function(e3, t3, i3) {
      e3 && ("string" != typeof t3 && (t3 = "Identifier" === t3.type ? t3.name : t3.value), b(e3, t3) && this.raiseRecoverable(i3, "Duplicate export '" + t3 + "'"), e3[t3] = true);
    }, L2.checkPatternExport = function(e3, t3) {
      var i3 = t3.type;
      if ("Identifier" === i3) this.checkExport(e3, t3, t3.start);
      else if ("ObjectPattern" === i3) for (var s2 = 0, r2 = t3.properties; s2 < r2.length; s2 += 1) {
        var n3 = r2[s2];
        this.checkPatternExport(e3, n3);
      }
      else if ("ArrayPattern" === i3) for (var a3 = 0, o2 = t3.elements; a3 < o2.length; a3 += 1) {
        var h3 = o2[a3];
        h3 && this.checkPatternExport(e3, h3);
      }
      else "Property" === i3 ? this.checkPatternExport(e3, t3.value) : "AssignmentPattern" === i3 ? this.checkPatternExport(e3, t3.left) : "RestElement" === i3 && this.checkPatternExport(e3, t3.argument);
    }, L2.checkVariableExport = function(e3, t3) {
      if (e3) for (var i3 = 0, s2 = t3; i3 < s2.length; i3 += 1) {
        var r2 = s2[i3];
        this.checkPatternExport(e3, r2.id);
      }
    }, L2.shouldParseExportStatement = function() {
      return "var" === this.type.keyword || "const" === this.type.keyword || "class" === this.type.keyword || "function" === this.type.keyword || this.isLet() || this.isAsyncFunction();
    }, L2.parseExportSpecifier = function(e3) {
      var t3 = this.startNode();
      return t3.local = this.parseModuleExportName(), t3.exported = this.eatContextual("as") ? this.parseModuleExportName() : t3.local, this.checkExport(e3, t3.exported, t3.exported.start), this.finishNode(t3, "ExportSpecifier");
    }, L2.parseExportSpecifiers = function(e3) {
      var t3 = [], i3 = true;
      for (this.expect(f2.braceL); !this.eat(f2.braceR); ) {
        if (i3) i3 = false;
        else if (this.expect(f2.comma), this.afterTrailingComma(f2.braceR)) break;
        t3.push(this.parseExportSpecifier(e3));
      }
      return t3;
    }, L2.parseImport = function(e3) {
      return this.next(), this.type === f2.string ? (e3.specifiers = V2, e3.source = this.parseExprAtom()) : (e3.specifiers = this.parseImportSpecifiers(), this.expectContextual("from"), e3.source = this.type === f2.string ? this.parseExprAtom() : this.unexpected()), this.options.ecmaVersion >= 16 && (e3.attributes = this.parseWithClause()), this.semicolon(), this.finishNode(e3, "ImportDeclaration");
    }, L2.parseImportSpecifier = function() {
      var e3 = this.startNode();
      return e3.imported = this.parseModuleExportName(), this.eatContextual("as") ? e3.local = this.parseIdent() : (this.checkUnreserved(e3.imported), e3.local = e3.imported), this.checkLValSimple(e3.local, 2), this.finishNode(e3, "ImportSpecifier");
    }, L2.parseImportDefaultSpecifier = function() {
      var e3 = this.startNode();
      return e3.local = this.parseIdent(), this.checkLValSimple(e3.local, 2), this.finishNode(e3, "ImportDefaultSpecifier");
    }, L2.parseImportNamespaceSpecifier = function() {
      var e3 = this.startNode();
      return this.next(), this.expectContextual("as"), e3.local = this.parseIdent(), this.checkLValSimple(e3.local, 2), this.finishNode(e3, "ImportNamespaceSpecifier");
    }, L2.parseImportSpecifiers = function() {
      var e3 = [], t3 = true;
      if (this.type === f2.name && (e3.push(this.parseImportDefaultSpecifier()), !this.eat(f2.comma))) return e3;
      if (this.type === f2.star) return e3.push(this.parseImportNamespaceSpecifier()), e3;
      for (this.expect(f2.braceL); !this.eat(f2.braceR); ) {
        if (t3) t3 = false;
        else if (this.expect(f2.comma), this.afterTrailingComma(f2.braceR)) break;
        e3.push(this.parseImportSpecifier());
      }
      return e3;
    }, L2.parseWithClause = function() {
      var e3 = [];
      if (!this.eat(f2._with)) return e3;
      this.expect(f2.braceL);
      for (var t3 = {}, i3 = true; !this.eat(f2.braceR); ) {
        if (i3) i3 = false;
        else if (this.expect(f2.comma), this.afterTrailingComma(f2.braceR)) break;
        var s2 = this.parseImportAttribute(), r2 = "Identifier" === s2.key.type ? s2.key.name : s2.key.value;
        b(t3, r2) && this.raiseRecoverable(s2.key.start, "Duplicate attribute key '" + r2 + "'"), t3[r2] = true, e3.push(s2);
      }
      return e3;
    }, L2.parseImportAttribute = function() {
      var e3 = this.startNode();
      return e3.key = this.type === f2.string ? this.parseExprAtom() : this.parseIdent("never" !== this.options.allowReserved), this.expect(f2.colon), this.type !== f2.string && this.unexpected(), e3.value = this.parseExprAtom(), this.finishNode(e3, "ImportAttribute");
    }, L2.parseModuleExportName = function() {
      if (this.options.ecmaVersion >= 13 && this.type === f2.string) {
        var e3 = this.parseLiteral(this.value);
        return w2.test(e3.value) && this.raise(e3.start, "An export name cannot include a lone surrogate."), e3;
      }
      return this.parseIdent(true);
    }, L2.adaptDirectivePrologue = function(e3) {
      for (var t3 = 0; t3 < e3.length && this.isDirectiveCandidate(e3[t3]); ++t3) e3[t3].directive = e3[t3].expression.raw.slice(1, -1);
    }, L2.isDirectiveCandidate = function(e3) {
      return this.options.ecmaVersion >= 5 && "ExpressionStatement" === e3.type && "Literal" === e3.expression.type && "string" == typeof e3.expression.value && ('"' === this.input[e3.start] || "'" === this.input[e3.start]);
    };
    var j = acorn_Parser.prototype;
    j.toAssignable = function(e3, t3, i3) {
      if (this.options.ecmaVersion >= 6 && e3) switch (e3.type) {
        case "Identifier":
          this.inAsync && "await" === e3.name && this.raise(e3.start, "Cannot use 'await' as identifier inside an async function");
          break;
        case "ObjectPattern":
        case "ArrayPattern":
        case "AssignmentPattern":
        case "RestElement":
          break;
        case "ObjectExpression":
          e3.type = "ObjectPattern", i3 && this.checkPatternErrors(i3, true);
          for (var s2 = 0, r2 = e3.properties; s2 < r2.length; s2 += 1) {
            var n3 = r2[s2];
            this.toAssignable(n3, t3), "RestElement" !== n3.type || "ArrayPattern" !== n3.argument.type && "ObjectPattern" !== n3.argument.type || this.raise(n3.argument.start, "Unexpected token");
          }
          break;
        case "Property":
          "init" !== e3.kind && this.raise(e3.key.start, "Object pattern can't contain getter or setter"), this.toAssignable(e3.value, t3);
          break;
        case "ArrayExpression":
          e3.type = "ArrayPattern", i3 && this.checkPatternErrors(i3, true), this.toAssignableList(e3.elements, t3);
          break;
        case "SpreadElement":
          e3.type = "RestElement", this.toAssignable(e3.argument, t3), "AssignmentPattern" === e3.argument.type && this.raise(e3.argument.start, "Rest elements cannot have a default value");
          break;
        case "AssignmentExpression":
          "=" !== e3.operator && this.raise(e3.left.end, "Only '=' operator can be used for specifying default value."), e3.type = "AssignmentPattern", delete e3.operator, this.toAssignable(e3.left, t3);
          break;
        case "ParenthesizedExpression":
          this.toAssignable(e3.expression, t3, i3);
          break;
        case "ChainExpression":
          this.raiseRecoverable(e3.start, "Optional chaining cannot appear in left-hand side");
          break;
        case "MemberExpression":
          if (!t3) break;
        default:
          this.raise(e3.start, "Assigning to rvalue");
      }
      else i3 && this.checkPatternErrors(i3, true);
      return e3;
    }, j.toAssignableList = function(e3, t3) {
      for (var i3 = e3.length, s2 = 0; s2 < i3; s2++) {
        var r2 = e3[s2];
        r2 && this.toAssignable(r2, t3);
      }
      if (i3) {
        var n3 = e3[i3 - 1];
        6 === this.options.ecmaVersion && t3 && n3 && "RestElement" === n3.type && "Identifier" !== n3.argument.type && this.unexpected(n3.argument.start);
      }
      return e3;
    }, j.parseSpread = function(e3) {
      var t3 = this.startNode();
      return this.next(), t3.argument = this.parseMaybeAssign(false, e3), this.finishNode(t3, "SpreadElement");
    }, j.parseRestBinding = function() {
      var e3 = this.startNode();
      return this.next(), 6 === this.options.ecmaVersion && this.type !== f2.name && this.unexpected(), e3.argument = this.parseBindingAtom(), this.finishNode(e3, "RestElement");
    }, j.parseBindingAtom = function() {
      if (this.options.ecmaVersion >= 6) switch (this.type) {
        case f2.bracketL:
          var e3 = this.startNode();
          return this.next(), e3.elements = this.parseBindingList(f2.bracketR, true, true), this.finishNode(e3, "ArrayPattern");
        case f2.braceL:
          return this.parseObj(true);
      }
      return this.parseIdent();
    }, j.parseBindingList = function(e3, t3, i3, s2) {
      for (var r2 = [], n3 = true; !this.eat(e3); ) if (n3 ? n3 = false : this.expect(f2.comma), t3 && this.type === f2.comma) r2.push(null);
      else {
        if (i3 && this.afterTrailingComma(e3)) break;
        if (this.type === f2.ellipsis) {
          var a3 = this.parseRestBinding();
          this.parseBindingListItem(a3), r2.push(a3), this.type === f2.comma && this.raiseRecoverable(this.start, "Comma is not permitted after the rest element"), this.expect(e3);
          break;
        }
        r2.push(this.parseAssignableListItem(s2));
      }
      return r2;
    }, j.parseAssignableListItem = function(e3) {
      var t3 = this.parseMaybeDefault(this.start, this.startLoc);
      return this.parseBindingListItem(t3), t3;
    }, j.parseBindingListItem = function(e3) {
      return e3;
    }, j.parseMaybeDefault = function(e3, t3, i3) {
      if (i3 = i3 || this.parseBindingAtom(), this.options.ecmaVersion < 6 || !this.eat(f2.eq)) return i3;
      var s2 = this.startNodeAt(e3, t3);
      return s2.left = i3, s2.right = this.parseMaybeAssign(), this.finishNode(s2, "AssignmentPattern");
    }, j.checkLValSimple = function(e3, t3, i3) {
      void 0 === t3 && (t3 = 0);
      var s2 = 0 !== t3;
      switch (e3.type) {
        case "Identifier":
          this.strict && this.reservedWordsStrictBind.test(e3.name) && this.raiseRecoverable(e3.start, (s2 ? "Binding " : "Assigning to ") + e3.name + " in strict mode"), s2 && (2 === t3 && "let" === e3.name && this.raiseRecoverable(e3.start, "let is disallowed as a lexically bound name"), i3 && (b(i3, e3.name) && this.raiseRecoverable(e3.start, "Argument name clash"), i3[e3.name] = true), 5 !== t3 && this.declareName(e3.name, t3, e3.start));
          break;
        case "ChainExpression":
          this.raiseRecoverable(e3.start, "Optional chaining cannot appear in left-hand side");
          break;
        case "MemberExpression":
          s2 && this.raiseRecoverable(e3.start, "Binding member expression");
          break;
        case "ParenthesizedExpression":
          return s2 && this.raiseRecoverable(e3.start, "Binding parenthesized expression"), this.checkLValSimple(e3.expression, t3, i3);
        default:
          this.raise(e3.start, (s2 ? "Binding" : "Assigning to") + " rvalue");
      }
    }, j.checkLValPattern = function(e3, t3, i3) {
      switch (void 0 === t3 && (t3 = 0), e3.type) {
        case "ObjectPattern":
          for (var s2 = 0, r2 = e3.properties; s2 < r2.length; s2 += 1) {
            var n3 = r2[s2];
            this.checkLValInnerPattern(n3, t3, i3);
          }
          break;
        case "ArrayPattern":
          for (var a3 = 0, o2 = e3.elements; a3 < o2.length; a3 += 1) {
            var h3 = o2[a3];
            h3 && this.checkLValInnerPattern(h3, t3, i3);
          }
          break;
        default:
          this.checkLValSimple(e3, t3, i3);
      }
    }, j.checkLValInnerPattern = function(e3, t3, i3) {
      switch (void 0 === t3 && (t3 = 0), e3.type) {
        case "Property":
          this.checkLValInnerPattern(e3.value, t3, i3);
          break;
        case "AssignmentPattern":
          this.checkLValPattern(e3.left, t3, i3);
          break;
        case "RestElement":
          this.checkLValPattern(e3.argument, t3, i3);
          break;
        default:
          this.checkLValPattern(e3, t3, i3);
      }
    };
    var acorn_TokContext = /* @__PURE__ */ __name(function(e3, t3, i3, s2, r2) {
      this.token = e3, this.isExpr = !!t3, this.preserveSpace = !!i3, this.override = s2, this.generator = !!r2;
    }, "acorn_TokContext"), F2 = { b_stat: new acorn_TokContext("{", false), b_expr: new acorn_TokContext("{", true), b_tmpl: new acorn_TokContext("${", false), p_stat: new acorn_TokContext("(", false), p_expr: new acorn_TokContext("(", true), q_tmpl: new acorn_TokContext("`", true, true, function(e3) {
      return e3.tryReadTemplateToken();
    }), f_stat: new acorn_TokContext("function", false), f_expr: new acorn_TokContext("function", true), f_expr_gen: new acorn_TokContext("function", true, false, null, true), f_gen: new acorn_TokContext("function", false, false, null, true) }, B2 = acorn_Parser.prototype;
    B2.initialContext = function() {
      return [F2.b_stat];
    }, B2.curContext = function() {
      return this.context[this.context.length - 1];
    }, B2.braceIsBlock = function(e3) {
      var t3 = this.curContext();
      return t3 === F2.f_expr || t3 === F2.f_stat || (e3 !== f2.colon || t3 !== F2.b_stat && t3 !== F2.b_expr ? e3 === f2._return || e3 === f2.name && this.exprAllowed ? m.test(this.input.slice(this.lastTokEnd, this.start)) : e3 === f2._else || e3 === f2.semi || e3 === f2.eof || e3 === f2.parenR || e3 === f2.arrow || (e3 === f2.braceL ? t3 === F2.b_stat : e3 !== f2._var && e3 !== f2._const && e3 !== f2.name && !this.exprAllowed) : !t3.isExpr);
    }, B2.inGeneratorContext = function() {
      for (var e3 = this.context.length - 1; e3 >= 1; e3--) {
        var t3 = this.context[e3];
        if ("function" === t3.token) return t3.generator;
      }
      return false;
    }, B2.updateContext = function(e3) {
      var t3, i3 = this.type;
      i3.keyword && e3 === f2.dot ? this.exprAllowed = false : (t3 = i3.updateContext) ? t3.call(this, e3) : this.exprAllowed = i3.beforeExpr;
    }, B2.overrideContext = function(e3) {
      this.curContext() !== e3 && (this.context[this.context.length - 1] = e3);
    }, f2.parenR.updateContext = f2.braceR.updateContext = function() {
      if (1 !== this.context.length) {
        var e3 = this.context.pop();
        e3 === F2.b_stat && "function" === this.curContext().token && (e3 = this.context.pop()), this.exprAllowed = !e3.isExpr;
      } else this.exprAllowed = true;
    }, f2.braceL.updateContext = function(e3) {
      this.context.push(this.braceIsBlock(e3) ? F2.b_stat : F2.b_expr), this.exprAllowed = true;
    }, f2.dollarBraceL.updateContext = function() {
      this.context.push(F2.b_tmpl), this.exprAllowed = true;
    }, f2.parenL.updateContext = function(e3) {
      var t3 = e3 === f2._if || e3 === f2._for || e3 === f2._with || e3 === f2._while;
      this.context.push(t3 ? F2.p_stat : F2.p_expr), this.exprAllowed = true;
    }, f2.incDec.updateContext = function() {
    }, f2._function.updateContext = f2._class.updateContext = function(e3) {
      !e3.beforeExpr || e3 === f2._else || e3 === f2.semi && this.curContext() !== F2.p_stat || e3 === f2._return && m.test(this.input.slice(this.lastTokEnd, this.start)) || (e3 === f2.colon || e3 === f2.braceL) && this.curContext() === F2.b_stat ? this.context.push(F2.f_stat) : this.context.push(F2.f_expr), this.exprAllowed = false;
    }, f2.colon.updateContext = function() {
      "function" === this.curContext().token && this.context.pop(), this.exprAllowed = true;
    }, f2.backQuote.updateContext = function() {
      this.curContext() === F2.q_tmpl ? this.context.pop() : this.context.push(F2.q_tmpl), this.exprAllowed = false;
    }, f2.star.updateContext = function(e3) {
      if (e3 === f2._function) {
        var t3 = this.context.length - 1;
        this.context[t3] === F2.f_expr ? this.context[t3] = F2.f_expr_gen : this.context[t3] = F2.f_gen;
      }
      this.exprAllowed = true;
    }, f2.name.updateContext = function(e3) {
      var t3 = false;
      this.options.ecmaVersion >= 6 && e3 !== f2.dot && ("of" === this.value && !this.exprAllowed || "yield" === this.value && this.inGeneratorContext()) && (t3 = true), this.exprAllowed = t3;
    };
    var $2 = acorn_Parser.prototype;
    function isLocalVariableAccess(e3) {
      return "Identifier" === e3.type || "ParenthesizedExpression" === e3.type && isLocalVariableAccess(e3.expression);
    }
    __name(isLocalVariableAccess, "isLocalVariableAccess");
    function isPrivateFieldAccess(e3) {
      return "MemberExpression" === e3.type && "PrivateIdentifier" === e3.property.type || "ChainExpression" === e3.type && isPrivateFieldAccess(e3.expression) || "ParenthesizedExpression" === e3.type && isPrivateFieldAccess(e3.expression);
    }
    __name(isPrivateFieldAccess, "isPrivateFieldAccess");
    $2.checkPropClash = function(e3, t3, i3) {
      if (!(this.options.ecmaVersion >= 9 && "SpreadElement" === e3.type || this.options.ecmaVersion >= 6 && (e3.computed || e3.method || e3.shorthand))) {
        var s2, r2 = e3.key;
        switch (r2.type) {
          case "Identifier":
            s2 = r2.name;
            break;
          case "Literal":
            s2 = String(r2.value);
            break;
          default:
            return;
        }
        var n3 = e3.kind;
        if (this.options.ecmaVersion >= 6) "__proto__" === s2 && "init" === n3 && (t3.proto && (i3 ? i3.doubleProto < 0 && (i3.doubleProto = r2.start) : this.raiseRecoverable(r2.start, "Redefinition of __proto__ property")), t3.proto = true);
        else {
          var a3 = t3[s2 = "$" + s2];
          if (a3) ("init" === n3 ? this.strict && a3.init || a3.get || a3.set : a3.init || a3[n3]) && this.raiseRecoverable(r2.start, "Redefinition of property");
          else a3 = t3[s2] = { init: false, get: false, set: false };
          a3[n3] = true;
        }
      }
    }, $2.parseExpression = function(e3, t3) {
      var i3 = this.start, s2 = this.startLoc, r2 = this.parseMaybeAssign(e3, t3);
      if (this.type === f2.comma) {
        var n3 = this.startNodeAt(i3, s2);
        for (n3.expressions = [r2]; this.eat(f2.comma); ) n3.expressions.push(this.parseMaybeAssign(e3, t3));
        return this.finishNode(n3, "SequenceExpression");
      }
      return r2;
    }, $2.parseMaybeAssign = function(e3, t3, i3) {
      if (this.isContextual("yield")) {
        if (this.inGenerator) return this.parseYield(e3);
        this.exprAllowed = false;
      }
      var s2 = false, r2 = -1, n3 = -1, a3 = -1;
      t3 ? (r2 = t3.parenthesizedAssign, n3 = t3.trailingComma, a3 = t3.doubleProto, t3.parenthesizedAssign = t3.trailingComma = -1) : (t3 = new acorn_DestructuringErrors(), s2 = true);
      var o2 = this.start, h3 = this.startLoc;
      this.type !== f2.parenL && this.type !== f2.name || (this.potentialArrowAt = this.start, this.potentialArrowInForAwait = "await" === e3);
      var c3 = this.parseMaybeConditional(e3, t3);
      if (i3 && (c3 = i3.call(this, c3, o2, h3)), this.type.isAssign) {
        var p2 = this.startNodeAt(o2, h3);
        return p2.operator = this.value, this.type === f2.eq && (c3 = this.toAssignable(c3, false, t3)), s2 || (t3.parenthesizedAssign = t3.trailingComma = t3.doubleProto = -1), t3.shorthandAssign >= c3.start && (t3.shorthandAssign = -1), this.type === f2.eq ? this.checkLValPattern(c3) : this.checkLValSimple(c3), p2.left = c3, this.next(), p2.right = this.parseMaybeAssign(e3), a3 > -1 && (t3.doubleProto = a3), this.finishNode(p2, "AssignmentExpression");
      }
      return s2 && this.checkExpressionErrors(t3, true), r2 > -1 && (t3.parenthesizedAssign = r2), n3 > -1 && (t3.trailingComma = n3), c3;
    }, $2.parseMaybeConditional = function(e3, t3) {
      var i3 = this.start, s2 = this.startLoc, r2 = this.parseExprOps(e3, t3);
      if (this.checkExpressionErrors(t3)) return r2;
      if (this.eat(f2.question)) {
        var n3 = this.startNodeAt(i3, s2);
        return n3.test = r2, n3.consequent = this.parseMaybeAssign(), this.expect(f2.colon), n3.alternate = this.parseMaybeAssign(e3), this.finishNode(n3, "ConditionalExpression");
      }
      return r2;
    }, $2.parseExprOps = function(e3, t3) {
      var i3 = this.start, s2 = this.startLoc, r2 = this.parseMaybeUnary(t3, false, false, e3);
      return this.checkExpressionErrors(t3) || r2.start === i3 && "ArrowFunctionExpression" === r2.type ? r2 : this.parseExprOp(r2, i3, s2, -1, e3);
    }, $2.parseExprOp = function(e3, t3, i3, s2, r2) {
      var n3 = this.type.binop;
      if (null != n3 && (!r2 || this.type !== f2._in) && n3 > s2) {
        var a3 = this.type === f2.logicalOR || this.type === f2.logicalAND, o2 = this.type === f2.coalesce;
        o2 && (n3 = f2.logicalAND.binop);
        var h3 = this.value;
        this.next();
        var c3 = this.start, p2 = this.startLoc, l3 = this.parseExprOp(this.parseMaybeUnary(null, false, false, r2), c3, p2, n3, r2), u3 = this.buildBinary(t3, i3, e3, l3, h3, a3 || o2);
        return (a3 && this.type === f2.coalesce || o2 && (this.type === f2.logicalOR || this.type === f2.logicalAND)) && this.raiseRecoverable(this.start, "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses"), this.parseExprOp(u3, t3, i3, s2, r2);
      }
      return e3;
    }, $2.buildBinary = function(e3, t3, i3, s2, r2, n3) {
      "PrivateIdentifier" === s2.type && this.raise(s2.start, "Private identifier can only be left side of binary expression");
      var a3 = this.startNodeAt(e3, t3);
      return a3.left = i3, a3.operator = r2, a3.right = s2, this.finishNode(a3, n3 ? "LogicalExpression" : "BinaryExpression");
    }, $2.parseMaybeUnary = function(e3, t3, i3, s2) {
      var r2, n3 = this.start, a3 = this.startLoc;
      if (this.isContextual("await") && this.canAwait) r2 = this.parseAwait(s2), t3 = true;
      else if (this.type.prefix) {
        var o2 = this.startNode(), h3 = this.type === f2.incDec;
        o2.operator = this.value, o2.prefix = true, this.next(), o2.argument = this.parseMaybeUnary(null, true, h3, s2), this.checkExpressionErrors(e3, true), h3 ? this.checkLValSimple(o2.argument) : this.strict && "delete" === o2.operator && isLocalVariableAccess(o2.argument) ? this.raiseRecoverable(o2.start, "Deleting local variable in strict mode") : "delete" === o2.operator && isPrivateFieldAccess(o2.argument) ? this.raiseRecoverable(o2.start, "Private fields can not be deleted") : t3 = true, r2 = this.finishNode(o2, h3 ? "UpdateExpression" : "UnaryExpression");
      } else if (t3 || this.type !== f2.privateId) {
        if (r2 = this.parseExprSubscripts(e3, s2), this.checkExpressionErrors(e3)) return r2;
        for (; this.type.postfix && !this.canInsertSemicolon(); ) {
          var c3 = this.startNodeAt(n3, a3);
          c3.operator = this.value, c3.prefix = false, c3.argument = r2, this.checkLValSimple(r2), this.next(), r2 = this.finishNode(c3, "UpdateExpression");
        }
      } else (s2 || 0 === this.privateNameStack.length) && this.options.checkPrivateFields && this.unexpected(), r2 = this.parsePrivateIdent(), this.type !== f2._in && this.unexpected();
      return i3 || !this.eat(f2.starstar) ? r2 : t3 ? void this.unexpected(this.lastTokStart) : this.buildBinary(n3, a3, r2, this.parseMaybeUnary(null, false, false, s2), "**", false);
    }, $2.parseExprSubscripts = function(e3, t3) {
      var i3 = this.start, s2 = this.startLoc, r2 = this.parseExprAtom(e3, t3);
      if ("ArrowFunctionExpression" === r2.type && ")" !== this.input.slice(this.lastTokStart, this.lastTokEnd)) return r2;
      var n3 = this.parseSubscripts(r2, i3, s2, false, t3);
      return e3 && "MemberExpression" === n3.type && (e3.parenthesizedAssign >= n3.start && (e3.parenthesizedAssign = -1), e3.parenthesizedBind >= n3.start && (e3.parenthesizedBind = -1), e3.trailingComma >= n3.start && (e3.trailingComma = -1)), n3;
    }, $2.parseSubscripts = function(e3, t3, i3, s2, r2) {
      for (var n3 = this.options.ecmaVersion >= 8 && "Identifier" === e3.type && "async" === e3.name && this.lastTokEnd === e3.end && !this.canInsertSemicolon() && e3.end - e3.start === 5 && this.potentialArrowAt === e3.start, a3 = false; ; ) {
        var o2 = this.parseSubscript(e3, t3, i3, s2, n3, a3, r2);
        if (o2.optional && (a3 = true), o2 === e3 || "ArrowFunctionExpression" === o2.type) {
          if (a3) {
            var h3 = this.startNodeAt(t3, i3);
            h3.expression = o2, o2 = this.finishNode(h3, "ChainExpression");
          }
          return o2;
        }
        e3 = o2;
      }
    }, $2.shouldParseAsyncArrow = function() {
      return !this.canInsertSemicolon() && this.eat(f2.arrow);
    }, $2.parseSubscriptAsyncArrow = function(e3, t3, i3, s2) {
      return this.parseArrowExpression(this.startNodeAt(e3, t3), i3, true, s2);
    }, $2.parseSubscript = function(e3, t3, i3, s2, r2, n3, a3) {
      var o2 = this.options.ecmaVersion >= 11, h3 = o2 && this.eat(f2.questionDot);
      s2 && h3 && this.raise(this.lastTokStart, "Optional chaining cannot appear in the callee of new expressions");
      var c3 = this.eat(f2.bracketL);
      if (c3 || h3 && this.type !== f2.parenL && this.type !== f2.backQuote || this.eat(f2.dot)) {
        var p2 = this.startNodeAt(t3, i3);
        p2.object = e3, c3 ? (p2.property = this.parseExpression(), this.expect(f2.bracketR)) : this.type === f2.privateId && "Super" !== e3.type ? p2.property = this.parsePrivateIdent() : p2.property = this.parseIdent("never" !== this.options.allowReserved), p2.computed = !!c3, o2 && (p2.optional = h3), e3 = this.finishNode(p2, "MemberExpression");
      } else if (!s2 && this.eat(f2.parenL)) {
        var l3 = new acorn_DestructuringErrors(), u3 = this.yieldPos, d3 = this.awaitPos, m2 = this.awaitIdentPos;
        this.yieldPos = 0, this.awaitPos = 0, this.awaitIdentPos = 0;
        var g3 = this.parseExprList(f2.parenR, this.options.ecmaVersion >= 8, false, l3);
        if (r2 && !h3 && this.shouldParseAsyncArrow()) return this.checkPatternErrors(l3, false), this.checkYieldAwaitInDefaultParams(), this.awaitIdentPos > 0 && this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function"), this.yieldPos = u3, this.awaitPos = d3, this.awaitIdentPos = m2, this.parseSubscriptAsyncArrow(t3, i3, g3, a3);
        this.checkExpressionErrors(l3, true), this.yieldPos = u3 || this.yieldPos, this.awaitPos = d3 || this.awaitPos, this.awaitIdentPos = m2 || this.awaitIdentPos;
        var x3 = this.startNodeAt(t3, i3);
        x3.callee = e3, x3.arguments = g3, o2 && (x3.optional = h3), e3 = this.finishNode(x3, "CallExpression");
      } else if (this.type === f2.backQuote) {
        (h3 || n3) && this.raise(this.start, "Optional chaining cannot appear in the tag of tagged template expressions");
        var v3 = this.startNodeAt(t3, i3);
        v3.tag = e3, v3.quasi = this.parseTemplate({ isTagged: true }), e3 = this.finishNode(v3, "TaggedTemplateExpression");
      }
      return e3;
    }, $2.parseExprAtom = function(e3, t3, i3) {
      this.type === f2.slash && this.readRegexp();
      var s2, r2 = this.potentialArrowAt === this.start;
      switch (this.type) {
        case f2._super:
          return this.allowSuper || this.raise(this.start, "'super' keyword outside a method"), s2 = this.startNode(), this.next(), this.type !== f2.parenL || this.allowDirectSuper || this.raise(s2.start, "super() call outside constructor of a subclass"), this.type !== f2.dot && this.type !== f2.bracketL && this.type !== f2.parenL && this.unexpected(), this.finishNode(s2, "Super");
        case f2._this:
          return s2 = this.startNode(), this.next(), this.finishNode(s2, "ThisExpression");
        case f2.name:
          var n3 = this.start, a3 = this.startLoc, o2 = this.containsEsc, h3 = this.parseIdent(false);
          if (this.options.ecmaVersion >= 8 && !o2 && "async" === h3.name && !this.canInsertSemicolon() && this.eat(f2._function)) return this.overrideContext(F2.f_expr), this.parseFunction(this.startNodeAt(n3, a3), 0, false, true, t3);
          if (r2 && !this.canInsertSemicolon()) {
            if (this.eat(f2.arrow)) return this.parseArrowExpression(this.startNodeAt(n3, a3), [h3], false, t3);
            if (this.options.ecmaVersion >= 8 && "async" === h3.name && this.type === f2.name && !o2 && (!this.potentialArrowInForAwait || "of" !== this.value || this.containsEsc)) return h3 = this.parseIdent(false), !this.canInsertSemicolon() && this.eat(f2.arrow) || this.unexpected(), this.parseArrowExpression(this.startNodeAt(n3, a3), [h3], true, t3);
          }
          return h3;
        case f2.regexp:
          var c3 = this.value;
          return (s2 = this.parseLiteral(c3.value)).regex = { pattern: c3.pattern, flags: c3.flags }, s2;
        case f2.num:
        case f2.string:
          return this.parseLiteral(this.value);
        case f2._null:
        case f2._true:
        case f2._false:
          return (s2 = this.startNode()).value = this.type === f2._null ? null : this.type === f2._true, s2.raw = this.type.keyword, this.next(), this.finishNode(s2, "Literal");
        case f2.parenL:
          var p2 = this.start, l3 = this.parseParenAndDistinguishExpression(r2, t3);
          return e3 && (e3.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(l3) && (e3.parenthesizedAssign = p2), e3.parenthesizedBind < 0 && (e3.parenthesizedBind = p2)), l3;
        case f2.bracketL:
          return s2 = this.startNode(), this.next(), s2.elements = this.parseExprList(f2.bracketR, true, true, e3), this.finishNode(s2, "ArrayExpression");
        case f2.braceL:
          return this.overrideContext(F2.b_expr), this.parseObj(false, e3);
        case f2._function:
          return s2 = this.startNode(), this.next(), this.parseFunction(s2, 0);
        case f2._class:
          return this.parseClass(this.startNode(), false);
        case f2._new:
          return this.parseNew();
        case f2.backQuote:
          return this.parseTemplate();
        case f2._import:
          return this.options.ecmaVersion >= 11 ? this.parseExprImport(i3) : this.unexpected();
        default:
          return this.parseExprAtomDefault();
      }
    }, $2.parseExprAtomDefault = function() {
      this.unexpected();
    }, $2.parseExprImport = function(e3) {
      var t3 = this.startNode();
      if (this.containsEsc && this.raiseRecoverable(this.start, "Escape sequence in keyword import"), this.next(), this.type === f2.parenL && !e3) return this.parseDynamicImport(t3);
      if (this.type === f2.dot) {
        var i3 = this.startNodeAt(t3.start, t3.loc && t3.loc.start);
        return i3.name = "import", t3.meta = this.finishNode(i3, "Identifier"), this.parseImportMeta(t3);
      }
      this.unexpected();
    }, $2.parseDynamicImport = function(e3) {
      if (this.next(), e3.source = this.parseMaybeAssign(), this.options.ecmaVersion >= 16) this.eat(f2.parenR) ? e3.options = null : (this.expect(f2.comma), this.afterTrailingComma(f2.parenR) ? e3.options = null : (e3.options = this.parseMaybeAssign(), this.eat(f2.parenR) || (this.expect(f2.comma), this.afterTrailingComma(f2.parenR) || this.unexpected())));
      else if (!this.eat(f2.parenR)) {
        var t3 = this.start;
        this.eat(f2.comma) && this.eat(f2.parenR) ? this.raiseRecoverable(t3, "Trailing comma is not allowed in import()") : this.unexpected(t3);
      }
      return this.finishNode(e3, "ImportExpression");
    }, $2.parseImportMeta = function(e3) {
      this.next();
      var t3 = this.containsEsc;
      return e3.property = this.parseIdent(true), "meta" !== e3.property.name && this.raiseRecoverable(e3.property.start, "The only valid meta property for import is 'import.meta'"), t3 && this.raiseRecoverable(e3.start, "'import.meta' must not contain escaped characters"), "module" === this.options.sourceType || this.options.allowImportExportEverywhere || this.raiseRecoverable(e3.start, "Cannot use 'import.meta' outside a module"), this.finishNode(e3, "MetaProperty");
    }, $2.parseLiteral = function(e3) {
      var t3 = this.startNode();
      return t3.value = e3, t3.raw = this.input.slice(this.start, this.end), 110 === t3.raw.charCodeAt(t3.raw.length - 1) && (t3.bigint = null != t3.value ? t3.value.toString() : t3.raw.slice(0, -1).replace(/_/g, "")), this.next(), this.finishNode(t3, "Literal");
    }, $2.parseParenExpression = function() {
      this.expect(f2.parenL);
      var e3 = this.parseExpression();
      return this.expect(f2.parenR), e3;
    }, $2.shouldParseArrow = function(e3) {
      return !this.canInsertSemicolon();
    }, $2.parseParenAndDistinguishExpression = function(e3, t3) {
      var i3, s2 = this.start, r2 = this.startLoc, n3 = this.options.ecmaVersion >= 8;
      if (this.options.ecmaVersion >= 6) {
        this.next();
        var a3, o2 = this.start, h3 = this.startLoc, c3 = [], p2 = true, l3 = false, u3 = new acorn_DestructuringErrors(), d3 = this.yieldPos, m2 = this.awaitPos;
        for (this.yieldPos = 0, this.awaitPos = 0; this.type !== f2.parenR; ) {
          if (p2 ? p2 = false : this.expect(f2.comma), n3 && this.afterTrailingComma(f2.parenR, true)) {
            l3 = true;
            break;
          }
          if (this.type === f2.ellipsis) {
            a3 = this.start, c3.push(this.parseParenItem(this.parseRestBinding())), this.type === f2.comma && this.raiseRecoverable(this.start, "Comma is not permitted after the rest element");
            break;
          }
          c3.push(this.parseMaybeAssign(false, u3, this.parseParenItem));
        }
        var g3 = this.lastTokEnd, x3 = this.lastTokEndLoc;
        if (this.expect(f2.parenR), e3 && this.shouldParseArrow(c3) && this.eat(f2.arrow)) return this.checkPatternErrors(u3, false), this.checkYieldAwaitInDefaultParams(), this.yieldPos = d3, this.awaitPos = m2, this.parseParenArrowList(s2, r2, c3, t3);
        c3.length && !l3 || this.unexpected(this.lastTokStart), a3 && this.unexpected(a3), this.checkExpressionErrors(u3, true), this.yieldPos = d3 || this.yieldPos, this.awaitPos = m2 || this.awaitPos, c3.length > 1 ? ((i3 = this.startNodeAt(o2, h3)).expressions = c3, this.finishNodeAt(i3, "SequenceExpression", g3, x3)) : i3 = c3[0];
      } else i3 = this.parseParenExpression();
      if (this.options.preserveParens) {
        var v3 = this.startNodeAt(s2, r2);
        return v3.expression = i3, this.finishNode(v3, "ParenthesizedExpression");
      }
      return i3;
    }, $2.parseParenItem = function(e3) {
      return e3;
    }, $2.parseParenArrowList = function(e3, t3, i3, s2) {
      return this.parseArrowExpression(this.startNodeAt(e3, t3), i3, false, s2);
    };
    var q2 = [];
    $2.parseNew = function() {
      this.containsEsc && this.raiseRecoverable(this.start, "Escape sequence in keyword new");
      var e3 = this.startNode();
      if (this.next(), this.options.ecmaVersion >= 6 && this.type === f2.dot) {
        var t3 = this.startNodeAt(e3.start, e3.loc && e3.loc.start);
        t3.name = "new", e3.meta = this.finishNode(t3, "Identifier"), this.next();
        var i3 = this.containsEsc;
        return e3.property = this.parseIdent(true), "target" !== e3.property.name && this.raiseRecoverable(e3.property.start, "The only valid meta property for new is 'new.target'"), i3 && this.raiseRecoverable(e3.start, "'new.target' must not contain escaped characters"), this.allowNewDotTarget || this.raiseRecoverable(e3.start, "'new.target' can only be used in functions and class static block"), this.finishNode(e3, "MetaProperty");
      }
      var s2 = this.start, r2 = this.startLoc;
      return e3.callee = this.parseSubscripts(this.parseExprAtom(null, false, true), s2, r2, true, false), this.eat(f2.parenL) ? e3.arguments = this.parseExprList(f2.parenR, this.options.ecmaVersion >= 8, false) : e3.arguments = q2, this.finishNode(e3, "NewExpression");
    }, $2.parseTemplateElement = function(e3) {
      var t3 = e3.isTagged, i3 = this.startNode();
      return this.type === f2.invalidTemplate ? (t3 || this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal"), i3.value = { raw: this.value.replace(/\r\n?/g, "\n"), cooked: null }) : i3.value = { raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"), cooked: this.value }, this.next(), i3.tail = this.type === f2.backQuote, this.finishNode(i3, "TemplateElement");
    }, $2.parseTemplate = function(e3) {
      void 0 === e3 && (e3 = {});
      var t3 = e3.isTagged;
      void 0 === t3 && (t3 = false);
      var i3 = this.startNode();
      this.next(), i3.expressions = [];
      var s2 = this.parseTemplateElement({ isTagged: t3 });
      for (i3.quasis = [s2]; !s2.tail; ) this.type === f2.eof && this.raise(this.pos, "Unterminated template literal"), this.expect(f2.dollarBraceL), i3.expressions.push(this.parseExpression()), this.expect(f2.braceR), i3.quasis.push(s2 = this.parseTemplateElement({ isTagged: t3 }));
      return this.next(), this.finishNode(i3, "TemplateLiteral");
    }, $2.isAsyncProp = function(e3) {
      return !e3.computed && "Identifier" === e3.key.type && "async" === e3.key.name && (this.type === f2.name || this.type === f2.num || this.type === f2.string || this.type === f2.bracketL || this.type.keyword || this.options.ecmaVersion >= 9 && this.type === f2.star) && !m.test(this.input.slice(this.lastTokEnd, this.start));
    }, $2.parseObj = function(e3, t3) {
      var i3 = this.startNode(), s2 = true, r2 = {};
      for (i3.properties = [], this.next(); !this.eat(f2.braceR); ) {
        if (s2) s2 = false;
        else if (this.expect(f2.comma), this.options.ecmaVersion >= 5 && this.afterTrailingComma(f2.braceR)) break;
        var n3 = this.parseProperty(e3, t3);
        e3 || this.checkPropClash(n3, r2, t3), i3.properties.push(n3);
      }
      return this.finishNode(i3, e3 ? "ObjectPattern" : "ObjectExpression");
    }, $2.parseProperty = function(e3, t3) {
      var i3, s2, r2, n3, a3 = this.startNode();
      if (this.options.ecmaVersion >= 9 && this.eat(f2.ellipsis)) return e3 ? (a3.argument = this.parseIdent(false), this.type === f2.comma && this.raiseRecoverable(this.start, "Comma is not permitted after the rest element"), this.finishNode(a3, "RestElement")) : (a3.argument = this.parseMaybeAssign(false, t3), this.type === f2.comma && t3 && t3.trailingComma < 0 && (t3.trailingComma = this.start), this.finishNode(a3, "SpreadElement"));
      this.options.ecmaVersion >= 6 && (a3.method = false, a3.shorthand = false, (e3 || t3) && (r2 = this.start, n3 = this.startLoc), e3 || (i3 = this.eat(f2.star)));
      var o2 = this.containsEsc;
      return this.parsePropertyName(a3), !e3 && !o2 && this.options.ecmaVersion >= 8 && !i3 && this.isAsyncProp(a3) ? (s2 = true, i3 = this.options.ecmaVersion >= 9 && this.eat(f2.star), this.parsePropertyName(a3)) : s2 = false, this.parsePropertyValue(a3, e3, i3, s2, r2, n3, t3, o2), this.finishNode(a3, "Property");
    }, $2.parseGetterSetter = function(e3) {
      var t3 = e3.key.name;
      this.parsePropertyName(e3), e3.value = this.parseMethod(false), e3.kind = t3;
      var i3 = "get" === e3.kind ? 0 : 1;
      if (e3.value.params.length !== i3) {
        var s2 = e3.value.start;
        "get" === e3.kind ? this.raiseRecoverable(s2, "getter should have no params") : this.raiseRecoverable(s2, "setter should have exactly one param");
      } else "set" === e3.kind && "RestElement" === e3.value.params[0].type && this.raiseRecoverable(e3.value.params[0].start, "Setter cannot use rest params");
    }, $2.parsePropertyValue = function(e3, t3, i3, s2, r2, n3, a3, o2) {
      (i3 || s2) && this.type === f2.colon && this.unexpected(), this.eat(f2.colon) ? (e3.value = t3 ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, a3), e3.kind = "init") : this.options.ecmaVersion >= 6 && this.type === f2.parenL ? (t3 && this.unexpected(), e3.method = true, e3.value = this.parseMethod(i3, s2), e3.kind = "init") : t3 || o2 || !(this.options.ecmaVersion >= 5) || e3.computed || "Identifier" !== e3.key.type || "get" !== e3.key.name && "set" !== e3.key.name || this.type === f2.comma || this.type === f2.braceR || this.type === f2.eq ? this.options.ecmaVersion >= 6 && !e3.computed && "Identifier" === e3.key.type ? ((i3 || s2) && this.unexpected(), this.checkUnreserved(e3.key), "await" !== e3.key.name || this.awaitIdentPos || (this.awaitIdentPos = r2), t3 ? e3.value = this.parseMaybeDefault(r2, n3, this.copyNode(e3.key)) : this.type === f2.eq && a3 ? (a3.shorthandAssign < 0 && (a3.shorthandAssign = this.start), e3.value = this.parseMaybeDefault(r2, n3, this.copyNode(e3.key))) : e3.value = this.copyNode(e3.key), e3.kind = "init", e3.shorthand = true) : this.unexpected() : ((i3 || s2) && this.unexpected(), this.parseGetterSetter(e3));
    }, $2.parsePropertyName = function(e3) {
      if (this.options.ecmaVersion >= 6) {
        if (this.eat(f2.bracketL)) return e3.computed = true, e3.key = this.parseMaybeAssign(), this.expect(f2.bracketR), e3.key;
        e3.computed = false;
      }
      return e3.key = this.type === f2.num || this.type === f2.string ? this.parseExprAtom() : this.parseIdent("never" !== this.options.allowReserved);
    }, $2.initFunction = function(e3) {
      e3.id = null, this.options.ecmaVersion >= 6 && (e3.generator = e3.expression = false), this.options.ecmaVersion >= 8 && (e3.async = false);
    }, $2.parseMethod = function(e3, t3, i3) {
      var s2 = this.startNode(), r2 = this.yieldPos, n3 = this.awaitPos, a3 = this.awaitIdentPos;
      return this.initFunction(s2), this.options.ecmaVersion >= 6 && (s2.generator = e3), this.options.ecmaVersion >= 8 && (s2.async = !!t3), this.yieldPos = 0, this.awaitPos = 0, this.awaitIdentPos = 0, this.enterScope(64 | functionFlags(t3, s2.generator) | (i3 ? 128 : 0)), this.expect(f2.parenL), s2.params = this.parseBindingList(f2.parenR, false, this.options.ecmaVersion >= 8), this.checkYieldAwaitInDefaultParams(), this.parseFunctionBody(s2, false, true, false), this.yieldPos = r2, this.awaitPos = n3, this.awaitIdentPos = a3, this.finishNode(s2, "FunctionExpression");
    }, $2.parseArrowExpression = function(e3, t3, i3, s2) {
      var r2 = this.yieldPos, n3 = this.awaitPos, a3 = this.awaitIdentPos;
      return this.enterScope(16 | functionFlags(i3, false)), this.initFunction(e3), this.options.ecmaVersion >= 8 && (e3.async = !!i3), this.yieldPos = 0, this.awaitPos = 0, this.awaitIdentPos = 0, e3.params = this.toAssignableList(t3, true), this.parseFunctionBody(e3, true, false, s2), this.yieldPos = r2, this.awaitPos = n3, this.awaitIdentPos = a3, this.finishNode(e3, "ArrowFunctionExpression");
    }, $2.parseFunctionBody = function(e3, t3, i3, s2) {
      var r2 = t3 && this.type !== f2.braceL, n3 = this.strict, a3 = false;
      if (r2) e3.body = this.parseMaybeAssign(s2), e3.expression = true, this.checkParams(e3, false);
      else {
        var o2 = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(e3.params);
        n3 && !o2 || (a3 = this.strictDirective(this.end)) && o2 && this.raiseRecoverable(e3.start, "Illegal 'use strict' directive in function with non-simple parameter list");
        var h3 = this.labels;
        this.labels = [], a3 && (this.strict = true), this.checkParams(e3, !n3 && !a3 && !t3 && !i3 && this.isSimpleParamList(e3.params)), this.strict && e3.id && this.checkLValSimple(e3.id, 5), e3.body = this.parseBlock(false, void 0, a3 && !n3), e3.expression = false, this.adaptDirectivePrologue(e3.body.body), this.labels = h3;
      }
      this.exitScope();
    }, $2.isSimpleParamList = function(e3) {
      for (var t3 = 0, i3 = e3; t3 < i3.length; t3 += 1) {
        if ("Identifier" !== i3[t3].type) return false;
      }
      return true;
    }, $2.checkParams = function(e3, t3) {
      for (var i3 = /* @__PURE__ */ Object.create(null), s2 = 0, r2 = e3.params; s2 < r2.length; s2 += 1) {
        var n3 = r2[s2];
        this.checkLValInnerPattern(n3, 1, t3 ? null : i3);
      }
    }, $2.parseExprList = function(e3, t3, i3, s2) {
      for (var r2 = [], n3 = true; !this.eat(e3); ) {
        if (n3) n3 = false;
        else if (this.expect(f2.comma), t3 && this.afterTrailingComma(e3)) break;
        var a3 = void 0;
        i3 && this.type === f2.comma ? a3 = null : this.type === f2.ellipsis ? (a3 = this.parseSpread(s2), s2 && this.type === f2.comma && s2.trailingComma < 0 && (s2.trailingComma = this.start)) : a3 = this.parseMaybeAssign(false, s2), r2.push(a3);
      }
      return r2;
    }, $2.checkUnreserved = function(e3) {
      var t3 = e3.start, i3 = e3.end, s2 = e3.name;
      (this.inGenerator && "yield" === s2 && this.raiseRecoverable(t3, "Cannot use 'yield' as identifier inside a generator"), this.inAsync && "await" === s2 && this.raiseRecoverable(t3, "Cannot use 'await' as identifier inside an async function"), this.currentThisScope().flags & P2 || "arguments" !== s2 || this.raiseRecoverable(t3, "Cannot use 'arguments' in class field initializer"), !this.inClassStaticBlock || "arguments" !== s2 && "await" !== s2 || this.raise(t3, "Cannot use " + s2 + " in class static initialization block"), this.keywords.test(s2) && this.raise(t3, "Unexpected keyword '" + s2 + "'"), this.options.ecmaVersion < 6 && -1 !== this.input.slice(t3, i3).indexOf("\\")) || (this.strict ? this.reservedWordsStrict : this.reservedWords).test(s2) && (this.inAsync || "await" !== s2 || this.raiseRecoverable(t3, "Cannot use keyword 'await' outside an async function"), this.raiseRecoverable(t3, "The keyword '" + s2 + "' is reserved"));
    }, $2.parseIdent = function(e3) {
      var t3 = this.parseIdentNode();
      return this.next(!!e3), this.finishNode(t3, "Identifier"), e3 || (this.checkUnreserved(t3), "await" !== t3.name || this.awaitIdentPos || (this.awaitIdentPos = t3.start)), t3;
    }, $2.parseIdentNode = function() {
      var e3 = this.startNode();
      return this.type === f2.name ? e3.name = this.value : this.type.keyword ? (e3.name = this.type.keyword, "class" !== e3.name && "function" !== e3.name || this.lastTokEnd === this.lastTokStart + 1 && 46 === this.input.charCodeAt(this.lastTokStart) || this.context.pop(), this.type = f2.name) : this.unexpected(), e3;
    }, $2.parsePrivateIdent = function() {
      var e3 = this.startNode();
      return this.type === f2.privateId ? e3.name = this.value : this.unexpected(), this.next(), this.finishNode(e3, "PrivateIdentifier"), this.options.checkPrivateFields && (0 === this.privateNameStack.length ? this.raise(e3.start, "Private field '#" + e3.name + "' must be declared in an enclosing class") : this.privateNameStack[this.privateNameStack.length - 1].used.push(e3)), e3;
    }, $2.parseYield = function(e3) {
      this.yieldPos || (this.yieldPos = this.start);
      var t3 = this.startNode();
      return this.next(), this.type === f2.semi || this.canInsertSemicolon() || this.type !== f2.star && !this.type.startsExpr ? (t3.delegate = false, t3.argument = null) : (t3.delegate = this.eat(f2.star), t3.argument = this.parseMaybeAssign(e3)), this.finishNode(t3, "YieldExpression");
    }, $2.parseAwait = function(e3) {
      this.awaitPos || (this.awaitPos = this.start);
      var t3 = this.startNode();
      return this.next(), t3.argument = this.parseMaybeUnary(null, true, false, e3), this.finishNode(t3, "AwaitExpression");
    };
    var W2 = acorn_Parser.prototype;
    W2.raise = function(e3, t3) {
      var i3 = getLineInfo(this.input, e3);
      t3 += " (" + i3.line + ":" + i3.column + ")", this.sourceFile && (t3 += " in " + this.sourceFile);
      var s2 = new SyntaxError(t3);
      throw s2.pos = e3, s2.loc = i3, s2.raisedAt = this.pos, s2;
    }, W2.raiseRecoverable = W2.raise, W2.curPosition = function() {
      if (this.options.locations) return new acorn_Position(this.curLine, this.pos - this.lineStart);
    };
    var G2 = acorn_Parser.prototype, acorn_Scope = /* @__PURE__ */ __name(function(e3) {
      this.flags = e3, this.var = [], this.lexical = [], this.functions = [];
    }, "acorn_Scope");
    G2.enterScope = function(e3) {
      this.scopeStack.push(new acorn_Scope(e3));
    }, G2.exitScope = function() {
      this.scopeStack.pop();
    }, G2.treatFunctionsAsVarInScope = function(e3) {
      return 2 & e3.flags || !this.inModule && 1 & e3.flags;
    }, G2.declareName = function(e3, t3, i3) {
      var s2 = false;
      if (2 === t3) {
        var r2 = this.currentScope();
        s2 = r2.lexical.indexOf(e3) > -1 || r2.functions.indexOf(e3) > -1 || r2.var.indexOf(e3) > -1, r2.lexical.push(e3), this.inModule && 1 & r2.flags && delete this.undefinedExports[e3];
      } else if (4 === t3) {
        this.currentScope().lexical.push(e3);
      } else if (3 === t3) {
        var n3 = this.currentScope();
        s2 = this.treatFunctionsAsVar ? n3.lexical.indexOf(e3) > -1 : n3.lexical.indexOf(e3) > -1 || n3.var.indexOf(e3) > -1, n3.functions.push(e3);
      } else for (var a3 = this.scopeStack.length - 1; a3 >= 0; --a3) {
        var o2 = this.scopeStack[a3];
        if (o2.lexical.indexOf(e3) > -1 && !(32 & o2.flags && o2.lexical[0] === e3) || !this.treatFunctionsAsVarInScope(o2) && o2.functions.indexOf(e3) > -1) {
          s2 = true;
          break;
        }
        if (o2.var.push(e3), this.inModule && 1 & o2.flags && delete this.undefinedExports[e3], o2.flags & P2) break;
      }
      s2 && this.raiseRecoverable(i3, "Identifier '" + e3 + "' has already been declared");
    }, G2.checkLocalExport = function(e3) {
      -1 === this.scopeStack[0].lexical.indexOf(e3.name) && -1 === this.scopeStack[0].var.indexOf(e3.name) && (this.undefinedExports[e3.name] = e3);
    }, G2.currentScope = function() {
      return this.scopeStack[this.scopeStack.length - 1];
    }, G2.currentVarScope = function() {
      for (var e3 = this.scopeStack.length - 1; ; e3--) {
        var t3 = this.scopeStack[e3];
        if (771 & t3.flags) return t3;
      }
    }, G2.currentThisScope = function() {
      for (var e3 = this.scopeStack.length - 1; ; e3--) {
        var t3 = this.scopeStack[e3];
        if (771 & t3.flags && !(16 & t3.flags)) return t3;
      }
    };
    var acorn_Node = /* @__PURE__ */ __name(function(e3, t3, i3) {
      this.type = "", this.start = t3, this.end = 0, e3.options.locations && (this.loc = new acorn_SourceLocation(e3, i3)), e3.options.directSourceFile && (this.sourceFile = e3.options.directSourceFile), e3.options.ranges && (this.range = [t3, 0]);
    }, "acorn_Node"), H2 = acorn_Parser.prototype;
    function finishNodeAt(e3, t3, i3, s2) {
      return e3.type = t3, e3.end = i3, this.options.locations && (e3.loc.end = s2), this.options.ranges && (e3.range[1] = i3), e3;
    }
    __name(finishNodeAt, "finishNodeAt");
    H2.startNode = function() {
      return new acorn_Node(this, this.start, this.startLoc);
    }, H2.startNodeAt = function(e3, t3) {
      return new acorn_Node(this, e3, t3);
    }, H2.finishNode = function(e3, t3) {
      return finishNodeAt.call(this, e3, t3, this.lastTokEnd, this.lastTokEndLoc);
    }, H2.finishNodeAt = function(e3, t3, i3, s2) {
      return finishNodeAt.call(this, e3, t3, i3, s2);
    }, H2.copyNode = function(e3) {
      var t3 = new acorn_Node(this, e3.start, this.startLoc);
      for (var i3 in e3) t3[i3] = e3[i3];
      return t3;
    };
    var K = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS", z2 = K + " Extended_Pictographic", J2 = z2 + " EBase EComp EMod EPres ExtPict", Y = { 9: K, 10: z2, 11: z2, 12: J2, 13: J2, 14: J2 }, Q2 = { 9: "", 10: "", 11: "", 12: "", 13: "", 14: "Basic_Emoji Emoji_Keycap_Sequence RGI_Emoji_Modifier_Sequence RGI_Emoji_Flag_Sequence RGI_Emoji_Tag_Sequence RGI_Emoji_ZWJ_Sequence RGI_Emoji" }, Z2 = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu", X = "Adlam Adlm Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb", ee2 = X + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd", te2 = ee2 + " Elymaic Elym Nandinagari Nand Nyiakeng_Puachue_Hmong Hmnp Wancho Wcho", ie2 = te2 + " Chorasmian Chrs Diak Dives_Akuru Khitan_Small_Script Kits Yezi Yezidi", se = ie2 + " Cypro_Minoan Cpmn Old_Uyghur Ougr Tangsa Tnsa Toto Vithkuqi Vith", re = { 9: X, 10: ee2, 11: te2, 12: ie2, 13: se, 14: se + " Gara Garay Gukh Gurung_Khema Hrkt Katakana_Or_Hiragana Kawi Kirat_Rai Krai Nag_Mundari Nagm Ol_Onal Onao Sunu Sunuwar Todhri Todr Tulu_Tigalari Tutg Unknown Zzzz" }, ne2 = {};
    function buildUnicodeData(e3) {
      var t3 = ne2[e3] = { binary: wordsRegexp(Y[e3] + " " + Z2), binaryOfStrings: wordsRegexp(Q2[e3]), nonBinary: { General_Category: wordsRegexp(Z2), Script: wordsRegexp(re[e3]) } };
      t3.nonBinary.Script_Extensions = t3.nonBinary.Script, t3.nonBinary.gc = t3.nonBinary.General_Category, t3.nonBinary.sc = t3.nonBinary.Script, t3.nonBinary.scx = t3.nonBinary.Script_Extensions;
    }
    __name(buildUnicodeData, "buildUnicodeData");
    for (var ae2 = 0, oe2 = [9, 10, 11, 12, 13, 14]; ae2 < oe2.length; ae2 += 1) {
      buildUnicodeData(oe2[ae2]);
    }
    var he = acorn_Parser.prototype, acorn_BranchID = /* @__PURE__ */ __name(function(e3, t3) {
      this.parent = e3, this.base = t3 || this;
    }, "acorn_BranchID");
    acorn_BranchID.prototype.separatedFrom = function(e3) {
      for (var t3 = this; t3; t3 = t3.parent) for (var i3 = e3; i3; i3 = i3.parent) if (t3.base === i3.base && t3 !== i3) return true;
      return false;
    }, acorn_BranchID.prototype.sibling = function() {
      return new acorn_BranchID(this.parent, this.base);
    };
    var acorn_RegExpValidationState = /* @__PURE__ */ __name(function(e3) {
      this.parser = e3, this.validFlags = "gim" + (e3.options.ecmaVersion >= 6 ? "uy" : "") + (e3.options.ecmaVersion >= 9 ? "s" : "") + (e3.options.ecmaVersion >= 13 ? "d" : "") + (e3.options.ecmaVersion >= 15 ? "v" : ""), this.unicodeProperties = ne2[e3.options.ecmaVersion >= 14 ? 14 : e3.options.ecmaVersion], this.source = "", this.flags = "", this.start = 0, this.switchU = false, this.switchV = false, this.switchN = false, this.pos = 0, this.lastIntValue = 0, this.lastStringValue = "", this.lastAssertionIsQuantifiable = false, this.numCapturingParens = 0, this.maxBackReference = 0, this.groupNames = /* @__PURE__ */ Object.create(null), this.backReferenceNames = [], this.branchID = null;
    }, "acorn_RegExpValidationState");
    function isRegularExpressionModifier(e3) {
      return 105 === e3 || 109 === e3 || 115 === e3;
    }
    __name(isRegularExpressionModifier, "isRegularExpressionModifier");
    function isSyntaxCharacter(e3) {
      return 36 === e3 || e3 >= 40 && e3 <= 43 || 46 === e3 || 63 === e3 || e3 >= 91 && e3 <= 94 || e3 >= 123 && e3 <= 125;
    }
    __name(isSyntaxCharacter, "isSyntaxCharacter");
    function isControlLetter(e3) {
      return e3 >= 65 && e3 <= 90 || e3 >= 97 && e3 <= 122;
    }
    __name(isControlLetter, "isControlLetter");
    acorn_RegExpValidationState.prototype.reset = function(e3, t3, i3) {
      var s2 = -1 !== i3.indexOf("v"), r2 = -1 !== i3.indexOf("u");
      this.start = 0 | e3, this.source = t3 + "", this.flags = i3, s2 && this.parser.options.ecmaVersion >= 15 ? (this.switchU = true, this.switchV = true, this.switchN = true) : (this.switchU = r2 && this.parser.options.ecmaVersion >= 6, this.switchV = false, this.switchN = r2 && this.parser.options.ecmaVersion >= 9);
    }, acorn_RegExpValidationState.prototype.raise = function(e3) {
      this.parser.raiseRecoverable(this.start, "Invalid regular expression: /" + this.source + "/: " + e3);
    }, acorn_RegExpValidationState.prototype.at = function(e3, t3) {
      void 0 === t3 && (t3 = false);
      var i3 = this.source, s2 = i3.length;
      if (e3 >= s2) return -1;
      var r2 = i3.charCodeAt(e3);
      if (!t3 && !this.switchU || r2 <= 55295 || r2 >= 57344 || e3 + 1 >= s2) return r2;
      var n3 = i3.charCodeAt(e3 + 1);
      return n3 >= 56320 && n3 <= 57343 ? (r2 << 10) + n3 - 56613888 : r2;
    }, acorn_RegExpValidationState.prototype.nextIndex = function(e3, t3) {
      void 0 === t3 && (t3 = false);
      var i3 = this.source, s2 = i3.length;
      if (e3 >= s2) return s2;
      var r2, n3 = i3.charCodeAt(e3);
      return !t3 && !this.switchU || n3 <= 55295 || n3 >= 57344 || e3 + 1 >= s2 || (r2 = i3.charCodeAt(e3 + 1)) < 56320 || r2 > 57343 ? e3 + 1 : e3 + 2;
    }, acorn_RegExpValidationState.prototype.current = function(e3) {
      return void 0 === e3 && (e3 = false), this.at(this.pos, e3);
    }, acorn_RegExpValidationState.prototype.lookahead = function(e3) {
      return void 0 === e3 && (e3 = false), this.at(this.nextIndex(this.pos, e3), e3);
    }, acorn_RegExpValidationState.prototype.advance = function(e3) {
      void 0 === e3 && (e3 = false), this.pos = this.nextIndex(this.pos, e3);
    }, acorn_RegExpValidationState.prototype.eat = function(e3, t3) {
      return void 0 === t3 && (t3 = false), this.current(t3) === e3 && (this.advance(t3), true);
    }, acorn_RegExpValidationState.prototype.eatChars = function(e3, t3) {
      void 0 === t3 && (t3 = false);
      for (var i3 = this.pos, s2 = 0, r2 = e3; s2 < r2.length; s2 += 1) {
        var n3 = r2[s2], a3 = this.at(i3, t3);
        if (-1 === a3 || a3 !== n3) return false;
        i3 = this.nextIndex(i3, t3);
      }
      return this.pos = i3, true;
    }, he.validateRegExpFlags = function(e3) {
      for (var t3 = e3.validFlags, i3 = e3.flags, s2 = false, r2 = false, n3 = 0; n3 < i3.length; n3++) {
        var a3 = i3.charAt(n3);
        -1 === t3.indexOf(a3) && this.raise(e3.start, "Invalid regular expression flag"), i3.indexOf(a3, n3 + 1) > -1 && this.raise(e3.start, "Duplicate regular expression flag"), "u" === a3 && (s2 = true), "v" === a3 && (r2 = true);
      }
      this.options.ecmaVersion >= 15 && s2 && r2 && this.raise(e3.start, "Invalid regular expression flag");
    }, he.validateRegExpPattern = function(e3) {
      this.regexp_pattern(e3), !e3.switchN && this.options.ecmaVersion >= 9 && function(e4) {
        for (var t3 in e4) return true;
        return false;
      }(e3.groupNames) && (e3.switchN = true, this.regexp_pattern(e3));
    }, he.regexp_pattern = function(e3) {
      e3.pos = 0, e3.lastIntValue = 0, e3.lastStringValue = "", e3.lastAssertionIsQuantifiable = false, e3.numCapturingParens = 0, e3.maxBackReference = 0, e3.groupNames = /* @__PURE__ */ Object.create(null), e3.backReferenceNames.length = 0, e3.branchID = null, this.regexp_disjunction(e3), e3.pos !== e3.source.length && (e3.eat(41) && e3.raise("Unmatched ')'"), (e3.eat(93) || e3.eat(125)) && e3.raise("Lone quantifier brackets")), e3.maxBackReference > e3.numCapturingParens && e3.raise("Invalid escape");
      for (var t3 = 0, i3 = e3.backReferenceNames; t3 < i3.length; t3 += 1) {
        var s2 = i3[t3];
        e3.groupNames[s2] || e3.raise("Invalid named capture referenced");
      }
    }, he.regexp_disjunction = function(e3) {
      var t3 = this.options.ecmaVersion >= 16;
      for (t3 && (e3.branchID = new acorn_BranchID(e3.branchID, null)), this.regexp_alternative(e3); e3.eat(124); ) t3 && (e3.branchID = e3.branchID.sibling()), this.regexp_alternative(e3);
      t3 && (e3.branchID = e3.branchID.parent), this.regexp_eatQuantifier(e3, true) && e3.raise("Nothing to repeat"), e3.eat(123) && e3.raise("Lone quantifier brackets");
    }, he.regexp_alternative = function(e3) {
      for (; e3.pos < e3.source.length && this.regexp_eatTerm(e3); ) ;
    }, he.regexp_eatTerm = function(e3) {
      return this.regexp_eatAssertion(e3) ? (e3.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(e3) && e3.switchU && e3.raise("Invalid quantifier"), true) : !!(e3.switchU ? this.regexp_eatAtom(e3) : this.regexp_eatExtendedAtom(e3)) && (this.regexp_eatQuantifier(e3), true);
    }, he.regexp_eatAssertion = function(e3) {
      var t3 = e3.pos;
      if (e3.lastAssertionIsQuantifiable = false, e3.eat(94) || e3.eat(36)) return true;
      if (e3.eat(92)) {
        if (e3.eat(66) || e3.eat(98)) return true;
        e3.pos = t3;
      }
      if (e3.eat(40) && e3.eat(63)) {
        var i3 = false;
        if (this.options.ecmaVersion >= 9 && (i3 = e3.eat(60)), e3.eat(61) || e3.eat(33)) return this.regexp_disjunction(e3), e3.eat(41) || e3.raise("Unterminated group"), e3.lastAssertionIsQuantifiable = !i3, true;
      }
      return e3.pos = t3, false;
    }, he.regexp_eatQuantifier = function(e3, t3) {
      return void 0 === t3 && (t3 = false), !!this.regexp_eatQuantifierPrefix(e3, t3) && (e3.eat(63), true);
    }, he.regexp_eatQuantifierPrefix = function(e3, t3) {
      return e3.eat(42) || e3.eat(43) || e3.eat(63) || this.regexp_eatBracedQuantifier(e3, t3);
    }, he.regexp_eatBracedQuantifier = function(e3, t3) {
      var i3 = e3.pos;
      if (e3.eat(123)) {
        var s2 = 0, r2 = -1;
        if (this.regexp_eatDecimalDigits(e3) && (s2 = e3.lastIntValue, e3.eat(44) && this.regexp_eatDecimalDigits(e3) && (r2 = e3.lastIntValue), e3.eat(125))) return -1 !== r2 && r2 < s2 && !t3 && e3.raise("numbers out of order in {} quantifier"), true;
        e3.switchU && !t3 && e3.raise("Incomplete quantifier"), e3.pos = i3;
      }
      return false;
    }, he.regexp_eatAtom = function(e3) {
      return this.regexp_eatPatternCharacters(e3) || e3.eat(46) || this.regexp_eatReverseSolidusAtomEscape(e3) || this.regexp_eatCharacterClass(e3) || this.regexp_eatUncapturingGroup(e3) || this.regexp_eatCapturingGroup(e3);
    }, he.regexp_eatReverseSolidusAtomEscape = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(92)) {
        if (this.regexp_eatAtomEscape(e3)) return true;
        e3.pos = t3;
      }
      return false;
    }, he.regexp_eatUncapturingGroup = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(40)) {
        if (e3.eat(63)) {
          if (this.options.ecmaVersion >= 16) {
            var i3 = this.regexp_eatModifiers(e3), s2 = e3.eat(45);
            if (i3 || s2) {
              for (var r2 = 0; r2 < i3.length; r2++) {
                var n3 = i3.charAt(r2);
                i3.indexOf(n3, r2 + 1) > -1 && e3.raise("Duplicate regular expression modifiers");
              }
              if (s2) {
                var a3 = this.regexp_eatModifiers(e3);
                i3 || a3 || 58 !== e3.current() || e3.raise("Invalid regular expression modifiers");
                for (var o2 = 0; o2 < a3.length; o2++) {
                  var h3 = a3.charAt(o2);
                  (a3.indexOf(h3, o2 + 1) > -1 || i3.indexOf(h3) > -1) && e3.raise("Duplicate regular expression modifiers");
                }
              }
            }
          }
          if (e3.eat(58)) {
            if (this.regexp_disjunction(e3), e3.eat(41)) return true;
            e3.raise("Unterminated group");
          }
        }
        e3.pos = t3;
      }
      return false;
    }, he.regexp_eatCapturingGroup = function(e3) {
      if (e3.eat(40)) {
        if (this.options.ecmaVersion >= 9 ? this.regexp_groupSpecifier(e3) : 63 === e3.current() && e3.raise("Invalid group"), this.regexp_disjunction(e3), e3.eat(41)) return e3.numCapturingParens += 1, true;
        e3.raise("Unterminated group");
      }
      return false;
    }, he.regexp_eatModifiers = function(e3) {
      for (var t3 = "", i3 = 0; -1 !== (i3 = e3.current()) && isRegularExpressionModifier(i3); ) t3 += codePointToString(i3), e3.advance();
      return t3;
    }, he.regexp_eatExtendedAtom = function(e3) {
      return e3.eat(46) || this.regexp_eatReverseSolidusAtomEscape(e3) || this.regexp_eatCharacterClass(e3) || this.regexp_eatUncapturingGroup(e3) || this.regexp_eatCapturingGroup(e3) || this.regexp_eatInvalidBracedQuantifier(e3) || this.regexp_eatExtendedPatternCharacter(e3);
    }, he.regexp_eatInvalidBracedQuantifier = function(e3) {
      return this.regexp_eatBracedQuantifier(e3, true) && e3.raise("Nothing to repeat"), false;
    }, he.regexp_eatSyntaxCharacter = function(e3) {
      var t3 = e3.current();
      return !!isSyntaxCharacter(t3) && (e3.lastIntValue = t3, e3.advance(), true);
    }, he.regexp_eatPatternCharacters = function(e3) {
      for (var t3 = e3.pos, i3 = 0; -1 !== (i3 = e3.current()) && !isSyntaxCharacter(i3); ) e3.advance();
      return e3.pos !== t3;
    }, he.regexp_eatExtendedPatternCharacter = function(e3) {
      var t3 = e3.current();
      return !(-1 === t3 || 36 === t3 || t3 >= 40 && t3 <= 43 || 46 === t3 || 63 === t3 || 91 === t3 || 94 === t3 || 124 === t3) && (e3.advance(), true);
    }, he.regexp_groupSpecifier = function(e3) {
      if (e3.eat(63)) {
        this.regexp_eatGroupName(e3) || e3.raise("Invalid group");
        var t3 = this.options.ecmaVersion >= 16, i3 = e3.groupNames[e3.lastStringValue];
        if (i3) if (t3) for (var s2 = 0, r2 = i3; s2 < r2.length; s2 += 1) {
          r2[s2].separatedFrom(e3.branchID) || e3.raise("Duplicate capture group name");
        }
        else e3.raise("Duplicate capture group name");
        t3 ? (i3 || (e3.groupNames[e3.lastStringValue] = [])).push(e3.branchID) : e3.groupNames[e3.lastStringValue] = true;
      }
    }, he.regexp_eatGroupName = function(e3) {
      if (e3.lastStringValue = "", e3.eat(60)) {
        if (this.regexp_eatRegExpIdentifierName(e3) && e3.eat(62)) return true;
        e3.raise("Invalid capture group name");
      }
      return false;
    }, he.regexp_eatRegExpIdentifierName = function(e3) {
      if (e3.lastStringValue = "", this.regexp_eatRegExpIdentifierStart(e3)) {
        for (e3.lastStringValue += codePointToString(e3.lastIntValue); this.regexp_eatRegExpIdentifierPart(e3); ) e3.lastStringValue += codePointToString(e3.lastIntValue);
        return true;
      }
      return false;
    }, he.regexp_eatRegExpIdentifierStart = function(e3) {
      var t3 = e3.pos, i3 = this.options.ecmaVersion >= 11, s2 = e3.current(i3);
      return e3.advance(i3), 92 === s2 && this.regexp_eatRegExpUnicodeEscapeSequence(e3, i3) && (s2 = e3.lastIntValue), function(e4) {
        return isIdentifierStart(e4, true) || 36 === e4 || 95 === e4;
      }(s2) ? (e3.lastIntValue = s2, true) : (e3.pos = t3, false);
    }, he.regexp_eatRegExpIdentifierPart = function(e3) {
      var t3 = e3.pos, i3 = this.options.ecmaVersion >= 11, s2 = e3.current(i3);
      return e3.advance(i3), 92 === s2 && this.regexp_eatRegExpUnicodeEscapeSequence(e3, i3) && (s2 = e3.lastIntValue), function(e4) {
        return isIdentifierChar(e4, true) || 36 === e4 || 95 === e4 || 8204 === e4 || 8205 === e4;
      }(s2) ? (e3.lastIntValue = s2, true) : (e3.pos = t3, false);
    }, he.regexp_eatAtomEscape = function(e3) {
      return !!(this.regexp_eatBackReference(e3) || this.regexp_eatCharacterClassEscape(e3) || this.regexp_eatCharacterEscape(e3) || e3.switchN && this.regexp_eatKGroupName(e3)) || (e3.switchU && (99 === e3.current() && e3.raise("Invalid unicode escape"), e3.raise("Invalid escape")), false);
    }, he.regexp_eatBackReference = function(e3) {
      var t3 = e3.pos;
      if (this.regexp_eatDecimalEscape(e3)) {
        var i3 = e3.lastIntValue;
        if (e3.switchU) return i3 > e3.maxBackReference && (e3.maxBackReference = i3), true;
        if (i3 <= e3.numCapturingParens) return true;
        e3.pos = t3;
      }
      return false;
    }, he.regexp_eatKGroupName = function(e3) {
      if (e3.eat(107)) {
        if (this.regexp_eatGroupName(e3)) return e3.backReferenceNames.push(e3.lastStringValue), true;
        e3.raise("Invalid named reference");
      }
      return false;
    }, he.regexp_eatCharacterEscape = function(e3) {
      return this.regexp_eatControlEscape(e3) || this.regexp_eatCControlLetter(e3) || this.regexp_eatZero(e3) || this.regexp_eatHexEscapeSequence(e3) || this.regexp_eatRegExpUnicodeEscapeSequence(e3, false) || !e3.switchU && this.regexp_eatLegacyOctalEscapeSequence(e3) || this.regexp_eatIdentityEscape(e3);
    }, he.regexp_eatCControlLetter = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(99)) {
        if (this.regexp_eatControlLetter(e3)) return true;
        e3.pos = t3;
      }
      return false;
    }, he.regexp_eatZero = function(e3) {
      return 48 === e3.current() && !isDecimalDigit(e3.lookahead()) && (e3.lastIntValue = 0, e3.advance(), true);
    }, he.regexp_eatControlEscape = function(e3) {
      var t3 = e3.current();
      return 116 === t3 ? (e3.lastIntValue = 9, e3.advance(), true) : 110 === t3 ? (e3.lastIntValue = 10, e3.advance(), true) : 118 === t3 ? (e3.lastIntValue = 11, e3.advance(), true) : 102 === t3 ? (e3.lastIntValue = 12, e3.advance(), true) : 114 === t3 && (e3.lastIntValue = 13, e3.advance(), true);
    }, he.regexp_eatControlLetter = function(e3) {
      var t3 = e3.current();
      return !!isControlLetter(t3) && (e3.lastIntValue = t3 % 32, e3.advance(), true);
    }, he.regexp_eatRegExpUnicodeEscapeSequence = function(e3, t3) {
      void 0 === t3 && (t3 = false);
      var i3, s2 = e3.pos, r2 = t3 || e3.switchU;
      if (e3.eat(117)) {
        if (this.regexp_eatFixedHexDigits(e3, 4)) {
          var n3 = e3.lastIntValue;
          if (r2 && n3 >= 55296 && n3 <= 56319) {
            var a3 = e3.pos;
            if (e3.eat(92) && e3.eat(117) && this.regexp_eatFixedHexDigits(e3, 4)) {
              var o2 = e3.lastIntValue;
              if (o2 >= 56320 && o2 <= 57343) return e3.lastIntValue = 1024 * (n3 - 55296) + (o2 - 56320) + 65536, true;
            }
            e3.pos = a3, e3.lastIntValue = n3;
          }
          return true;
        }
        if (r2 && e3.eat(123) && this.regexp_eatHexDigits(e3) && e3.eat(125) && ((i3 = e3.lastIntValue) >= 0 && i3 <= 1114111)) return true;
        r2 && e3.raise("Invalid unicode escape"), e3.pos = s2;
      }
      return false;
    }, he.regexp_eatIdentityEscape = function(e3) {
      if (e3.switchU) return !!this.regexp_eatSyntaxCharacter(e3) || !!e3.eat(47) && (e3.lastIntValue = 47, true);
      var t3 = e3.current();
      return !(99 === t3 || e3.switchN && 107 === t3) && (e3.lastIntValue = t3, e3.advance(), true);
    }, he.regexp_eatDecimalEscape = function(e3) {
      e3.lastIntValue = 0;
      var t3 = e3.current();
      if (t3 >= 49 && t3 <= 57) {
        do {
          e3.lastIntValue = 10 * e3.lastIntValue + (t3 - 48), e3.advance();
        } while ((t3 = e3.current()) >= 48 && t3 <= 57);
        return true;
      }
      return false;
    };
    function isUnicodePropertyNameCharacter(e3) {
      return isControlLetter(e3) || 95 === e3;
    }
    __name(isUnicodePropertyNameCharacter, "isUnicodePropertyNameCharacter");
    function isUnicodePropertyValueCharacter(e3) {
      return isUnicodePropertyNameCharacter(e3) || isDecimalDigit(e3);
    }
    __name(isUnicodePropertyValueCharacter, "isUnicodePropertyValueCharacter");
    function isDecimalDigit(e3) {
      return e3 >= 48 && e3 <= 57;
    }
    __name(isDecimalDigit, "isDecimalDigit");
    function isHexDigit(e3) {
      return e3 >= 48 && e3 <= 57 || e3 >= 65 && e3 <= 70 || e3 >= 97 && e3 <= 102;
    }
    __name(isHexDigit, "isHexDigit");
    function hexToInt(e3) {
      return e3 >= 65 && e3 <= 70 ? e3 - 65 + 10 : e3 >= 97 && e3 <= 102 ? e3 - 97 + 10 : e3 - 48;
    }
    __name(hexToInt, "hexToInt");
    function isOctalDigit(e3) {
      return e3 >= 48 && e3 <= 55;
    }
    __name(isOctalDigit, "isOctalDigit");
    he.regexp_eatCharacterClassEscape = function(e3) {
      var t3 = e3.current();
      if (/* @__PURE__ */ function(e4) {
        return 100 === e4 || 68 === e4 || 115 === e4 || 83 === e4 || 119 === e4 || 87 === e4;
      }(t3)) return e3.lastIntValue = -1, e3.advance(), 1;
      var i3 = false;
      if (e3.switchU && this.options.ecmaVersion >= 9 && ((i3 = 80 === t3) || 112 === t3)) {
        var s2;
        if (e3.lastIntValue = -1, e3.advance(), e3.eat(123) && (s2 = this.regexp_eatUnicodePropertyValueExpression(e3)) && e3.eat(125)) return i3 && 2 === s2 && e3.raise("Invalid property name"), s2;
        e3.raise("Invalid property name");
      }
      return 0;
    }, he.regexp_eatUnicodePropertyValueExpression = function(e3) {
      var t3 = e3.pos;
      if (this.regexp_eatUnicodePropertyName(e3) && e3.eat(61)) {
        var i3 = e3.lastStringValue;
        if (this.regexp_eatUnicodePropertyValue(e3)) {
          var s2 = e3.lastStringValue;
          return this.regexp_validateUnicodePropertyNameAndValue(e3, i3, s2), 1;
        }
      }
      if (e3.pos = t3, this.regexp_eatLoneUnicodePropertyNameOrValue(e3)) {
        var r2 = e3.lastStringValue;
        return this.regexp_validateUnicodePropertyNameOrValue(e3, r2);
      }
      return 0;
    }, he.regexp_validateUnicodePropertyNameAndValue = function(e3, t3, i3) {
      b(e3.unicodeProperties.nonBinary, t3) || e3.raise("Invalid property name"), e3.unicodeProperties.nonBinary[t3].test(i3) || e3.raise("Invalid property value");
    }, he.regexp_validateUnicodePropertyNameOrValue = function(e3, t3) {
      return e3.unicodeProperties.binary.test(t3) ? 1 : e3.switchV && e3.unicodeProperties.binaryOfStrings.test(t3) ? 2 : void e3.raise("Invalid property name");
    }, he.regexp_eatUnicodePropertyName = function(e3) {
      var t3 = 0;
      for (e3.lastStringValue = ""; isUnicodePropertyNameCharacter(t3 = e3.current()); ) e3.lastStringValue += codePointToString(t3), e3.advance();
      return "" !== e3.lastStringValue;
    }, he.regexp_eatUnicodePropertyValue = function(e3) {
      var t3 = 0;
      for (e3.lastStringValue = ""; isUnicodePropertyValueCharacter(t3 = e3.current()); ) e3.lastStringValue += codePointToString(t3), e3.advance();
      return "" !== e3.lastStringValue;
    }, he.regexp_eatLoneUnicodePropertyNameOrValue = function(e3) {
      return this.regexp_eatUnicodePropertyValue(e3);
    }, he.regexp_eatCharacterClass = function(e3) {
      if (e3.eat(91)) {
        var t3 = e3.eat(94), i3 = this.regexp_classContents(e3);
        return e3.eat(93) || e3.raise("Unterminated character class"), t3 && 2 === i3 && e3.raise("Negated character class may contain strings"), true;
      }
      return false;
    }, he.regexp_classContents = function(e3) {
      return 93 === e3.current() ? 1 : e3.switchV ? this.regexp_classSetExpression(e3) : (this.regexp_nonEmptyClassRanges(e3), 1);
    }, he.regexp_nonEmptyClassRanges = function(e3) {
      for (; this.regexp_eatClassAtom(e3); ) {
        var t3 = e3.lastIntValue;
        if (e3.eat(45) && this.regexp_eatClassAtom(e3)) {
          var i3 = e3.lastIntValue;
          !e3.switchU || -1 !== t3 && -1 !== i3 || e3.raise("Invalid character class"), -1 !== t3 && -1 !== i3 && t3 > i3 && e3.raise("Range out of order in character class");
        }
      }
    }, he.regexp_eatClassAtom = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(92)) {
        if (this.regexp_eatClassEscape(e3)) return true;
        if (e3.switchU) {
          var i3 = e3.current();
          (99 === i3 || isOctalDigit(i3)) && e3.raise("Invalid class escape"), e3.raise("Invalid escape");
        }
        e3.pos = t3;
      }
      var s2 = e3.current();
      return 93 !== s2 && (e3.lastIntValue = s2, e3.advance(), true);
    }, he.regexp_eatClassEscape = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(98)) return e3.lastIntValue = 8, true;
      if (e3.switchU && e3.eat(45)) return e3.lastIntValue = 45, true;
      if (!e3.switchU && e3.eat(99)) {
        if (this.regexp_eatClassControlLetter(e3)) return true;
        e3.pos = t3;
      }
      return this.regexp_eatCharacterClassEscape(e3) || this.regexp_eatCharacterEscape(e3);
    }, he.regexp_classSetExpression = function(e3) {
      var t3, i3 = 1;
      if (this.regexp_eatClassSetRange(e3)) ;
      else if (t3 = this.regexp_eatClassSetOperand(e3)) {
        2 === t3 && (i3 = 2);
        for (var s2 = e3.pos; e3.eatChars([38, 38]); ) 38 !== e3.current() && (t3 = this.regexp_eatClassSetOperand(e3)) ? 2 !== t3 && (i3 = 1) : e3.raise("Invalid character in character class");
        if (s2 !== e3.pos) return i3;
        for (; e3.eatChars([45, 45]); ) this.regexp_eatClassSetOperand(e3) || e3.raise("Invalid character in character class");
        if (s2 !== e3.pos) return i3;
      } else e3.raise("Invalid character in character class");
      for (; ; ) if (!this.regexp_eatClassSetRange(e3)) {
        if (!(t3 = this.regexp_eatClassSetOperand(e3))) return i3;
        2 === t3 && (i3 = 2);
      }
    }, he.regexp_eatClassSetRange = function(e3) {
      var t3 = e3.pos;
      if (this.regexp_eatClassSetCharacter(e3)) {
        var i3 = e3.lastIntValue;
        if (e3.eat(45) && this.regexp_eatClassSetCharacter(e3)) {
          var s2 = e3.lastIntValue;
          return -1 !== i3 && -1 !== s2 && i3 > s2 && e3.raise("Range out of order in character class"), true;
        }
        e3.pos = t3;
      }
      return false;
    }, he.regexp_eatClassSetOperand = function(e3) {
      return this.regexp_eatClassSetCharacter(e3) ? 1 : this.regexp_eatClassStringDisjunction(e3) || this.regexp_eatNestedClass(e3);
    }, he.regexp_eatNestedClass = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(91)) {
        var i3 = e3.eat(94), s2 = this.regexp_classContents(e3);
        if (e3.eat(93)) return i3 && 2 === s2 && e3.raise("Negated character class may contain strings"), s2;
        e3.pos = t3;
      }
      if (e3.eat(92)) {
        var r2 = this.regexp_eatCharacterClassEscape(e3);
        if (r2) return r2;
        e3.pos = t3;
      }
      return null;
    }, he.regexp_eatClassStringDisjunction = function(e3) {
      var t3 = e3.pos;
      if (e3.eatChars([92, 113])) {
        if (e3.eat(123)) {
          var i3 = this.regexp_classStringDisjunctionContents(e3);
          if (e3.eat(125)) return i3;
        } else e3.raise("Invalid escape");
        e3.pos = t3;
      }
      return null;
    }, he.regexp_classStringDisjunctionContents = function(e3) {
      for (var t3 = this.regexp_classString(e3); e3.eat(124); ) 2 === this.regexp_classString(e3) && (t3 = 2);
      return t3;
    }, he.regexp_classString = function(e3) {
      for (var t3 = 0; this.regexp_eatClassSetCharacter(e3); ) t3++;
      return 1 === t3 ? 1 : 2;
    }, he.regexp_eatClassSetCharacter = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(92)) return !(!this.regexp_eatCharacterEscape(e3) && !this.regexp_eatClassSetReservedPunctuator(e3)) || (e3.eat(98) ? (e3.lastIntValue = 8, true) : (e3.pos = t3, false));
      var i3 = e3.current();
      return !(i3 < 0 || i3 === e3.lookahead() && function(e4) {
        return 33 === e4 || e4 >= 35 && e4 <= 38 || e4 >= 42 && e4 <= 44 || 46 === e4 || e4 >= 58 && e4 <= 64 || 94 === e4 || 96 === e4 || 126 === e4;
      }(i3)) && (!function(e4) {
        return 40 === e4 || 41 === e4 || 45 === e4 || 47 === e4 || e4 >= 91 && e4 <= 93 || e4 >= 123 && e4 <= 125;
      }(i3) && (e3.advance(), e3.lastIntValue = i3, true));
    }, he.regexp_eatClassSetReservedPunctuator = function(e3) {
      var t3 = e3.current();
      return !!function(e4) {
        return 33 === e4 || 35 === e4 || 37 === e4 || 38 === e4 || 44 === e4 || 45 === e4 || e4 >= 58 && e4 <= 62 || 64 === e4 || 96 === e4 || 126 === e4;
      }(t3) && (e3.lastIntValue = t3, e3.advance(), true);
    }, he.regexp_eatClassControlLetter = function(e3) {
      var t3 = e3.current();
      return !(!isDecimalDigit(t3) && 95 !== t3) && (e3.lastIntValue = t3 % 32, e3.advance(), true);
    }, he.regexp_eatHexEscapeSequence = function(e3) {
      var t3 = e3.pos;
      if (e3.eat(120)) {
        if (this.regexp_eatFixedHexDigits(e3, 2)) return true;
        e3.switchU && e3.raise("Invalid escape"), e3.pos = t3;
      }
      return false;
    }, he.regexp_eatDecimalDigits = function(e3) {
      var t3 = e3.pos, i3 = 0;
      for (e3.lastIntValue = 0; isDecimalDigit(i3 = e3.current()); ) e3.lastIntValue = 10 * e3.lastIntValue + (i3 - 48), e3.advance();
      return e3.pos !== t3;
    }, he.regexp_eatHexDigits = function(e3) {
      var t3 = e3.pos, i3 = 0;
      for (e3.lastIntValue = 0; isHexDigit(i3 = e3.current()); ) e3.lastIntValue = 16 * e3.lastIntValue + hexToInt(i3), e3.advance();
      return e3.pos !== t3;
    }, he.regexp_eatLegacyOctalEscapeSequence = function(e3) {
      if (this.regexp_eatOctalDigit(e3)) {
        var t3 = e3.lastIntValue;
        if (this.regexp_eatOctalDigit(e3)) {
          var i3 = e3.lastIntValue;
          t3 <= 3 && this.regexp_eatOctalDigit(e3) ? e3.lastIntValue = 64 * t3 + 8 * i3 + e3.lastIntValue : e3.lastIntValue = 8 * t3 + i3;
        } else e3.lastIntValue = t3;
        return true;
      }
      return false;
    }, he.regexp_eatOctalDigit = function(e3) {
      var t3 = e3.current();
      return isOctalDigit(t3) ? (e3.lastIntValue = t3 - 48, e3.advance(), true) : (e3.lastIntValue = 0, false);
    }, he.regexp_eatFixedHexDigits = function(e3, t3) {
      var i3 = e3.pos;
      e3.lastIntValue = 0;
      for (var s2 = 0; s2 < t3; ++s2) {
        var r2 = e3.current();
        if (!isHexDigit(r2)) return e3.pos = i3, false;
        e3.lastIntValue = 16 * e3.lastIntValue + hexToInt(r2), e3.advance();
      }
      return true;
    };
    var acorn_Token = /* @__PURE__ */ __name(function(e3) {
      this.type = e3.type, this.value = e3.value, this.start = e3.start, this.end = e3.end, e3.options.locations && (this.loc = new acorn_SourceLocation(e3, e3.startLoc, e3.endLoc)), e3.options.ranges && (this.range = [e3.start, e3.end]);
    }, "acorn_Token"), ce2 = acorn_Parser.prototype;
    function stringToBigInt(e3) {
      return "function" != typeof BigInt ? null : BigInt(e3.replace(/_/g, ""));
    }
    __name(stringToBigInt, "stringToBigInt");
    ce2.next = function(e3) {
      !e3 && this.type.keyword && this.containsEsc && this.raiseRecoverable(this.start, "Escape sequence in keyword " + this.type.keyword), this.options.onToken && this.options.onToken(new acorn_Token(this)), this.lastTokEnd = this.end, this.lastTokStart = this.start, this.lastTokEndLoc = this.endLoc, this.lastTokStartLoc = this.startLoc, this.nextToken();
    }, ce2.getToken = function() {
      return this.next(), new acorn_Token(this);
    }, "undefined" != typeof Symbol && (ce2[Symbol.iterator] = function() {
      var e3 = this;
      return { next: /* @__PURE__ */ __name(function() {
        var t3 = e3.getToken();
        return { done: t3.type === f2.eof, value: t3 };
      }, "next") };
    }), ce2.nextToken = function() {
      var e3 = this.curContext();
      return e3 && e3.preserveSpace || this.skipSpace(), this.start = this.pos, this.options.locations && (this.startLoc = this.curPosition()), this.pos >= this.input.length ? this.finishToken(f2.eof) : e3.override ? e3.override(this) : void this.readToken(this.fullCharCodeAtPos());
    }, ce2.readToken = function(e3) {
      return isIdentifierStart(e3, this.options.ecmaVersion >= 6) || 92 === e3 ? this.readWord() : this.getTokenFromCode(e3);
    }, ce2.fullCharCodeAtPos = function() {
      var e3 = this.input.charCodeAt(this.pos);
      if (e3 <= 55295 || e3 >= 56320) return e3;
      var t3 = this.input.charCodeAt(this.pos + 1);
      return t3 <= 56319 || t3 >= 57344 ? e3 : (e3 << 10) + t3 - 56613888;
    }, ce2.skipBlockComment = function() {
      var e3 = this.options.onComment && this.curPosition(), t3 = this.pos, i3 = this.input.indexOf("*/", this.pos += 2);
      if (-1 === i3 && this.raise(this.pos - 2, "Unterminated comment"), this.pos = i3 + 2, this.options.locations) for (var s2 = void 0, r2 = t3; (s2 = nextLineBreak(this.input, r2, this.pos)) > -1; ) ++this.curLine, r2 = this.lineStart = s2;
      this.options.onComment && this.options.onComment(true, this.input.slice(t3 + 2, i3), t3, this.pos, e3, this.curPosition());
    }, ce2.skipLineComment = function(e3) {
      for (var t3 = this.pos, i3 = this.options.onComment && this.curPosition(), s2 = this.input.charCodeAt(this.pos += e3); this.pos < this.input.length && !isNewLine(s2); ) s2 = this.input.charCodeAt(++this.pos);
      this.options.onComment && this.options.onComment(false, this.input.slice(t3 + e3, this.pos), t3, this.pos, i3, this.curPosition());
    }, ce2.skipSpace = function() {
      e: for (; this.pos < this.input.length; ) {
        var e3 = this.input.charCodeAt(this.pos);
        switch (e3) {
          case 32:
          case 160:
            ++this.pos;
            break;
          case 13:
            10 === this.input.charCodeAt(this.pos + 1) && ++this.pos;
          case 10:
          case 8232:
          case 8233:
            ++this.pos, this.options.locations && (++this.curLine, this.lineStart = this.pos);
            break;
          case 47:
            switch (this.input.charCodeAt(this.pos + 1)) {
              case 42:
                this.skipBlockComment();
                break;
              case 47:
                this.skipLineComment(2);
                break;
              default:
                break e;
            }
            break;
          default:
            if (!(e3 > 8 && e3 < 14 || e3 >= 5760 && x2.test(String.fromCharCode(e3)))) break e;
            ++this.pos;
        }
      }
    }, ce2.finishToken = function(e3, t3) {
      this.end = this.pos, this.options.locations && (this.endLoc = this.curPosition());
      var i3 = this.type;
      this.type = e3, this.value = t3, this.updateContext(i3);
    }, ce2.readToken_dot = function() {
      var e3 = this.input.charCodeAt(this.pos + 1);
      if (e3 >= 48 && e3 <= 57) return this.readNumber(true);
      var t3 = this.input.charCodeAt(this.pos + 2);
      return this.options.ecmaVersion >= 6 && 46 === e3 && 46 === t3 ? (this.pos += 3, this.finishToken(f2.ellipsis)) : (++this.pos, this.finishToken(f2.dot));
    }, ce2.readToken_slash = function() {
      var e3 = this.input.charCodeAt(this.pos + 1);
      return this.exprAllowed ? (++this.pos, this.readRegexp()) : 61 === e3 ? this.finishOp(f2.assign, 2) : this.finishOp(f2.slash, 1);
    }, ce2.readToken_mult_modulo_exp = function(e3) {
      var t3 = this.input.charCodeAt(this.pos + 1), i3 = 1, s2 = 42 === e3 ? f2.star : f2.modulo;
      return this.options.ecmaVersion >= 7 && 42 === e3 && 42 === t3 && (++i3, s2 = f2.starstar, t3 = this.input.charCodeAt(this.pos + 2)), 61 === t3 ? this.finishOp(f2.assign, i3 + 1) : this.finishOp(s2, i3);
    }, ce2.readToken_pipe_amp = function(e3) {
      var t3 = this.input.charCodeAt(this.pos + 1);
      if (t3 === e3) {
        if (this.options.ecmaVersion >= 12) {
          if (61 === this.input.charCodeAt(this.pos + 2)) return this.finishOp(f2.assign, 3);
        }
        return this.finishOp(124 === e3 ? f2.logicalOR : f2.logicalAND, 2);
      }
      return 61 === t3 ? this.finishOp(f2.assign, 2) : this.finishOp(124 === e3 ? f2.bitwiseOR : f2.bitwiseAND, 1);
    }, ce2.readToken_caret = function() {
      return 61 === this.input.charCodeAt(this.pos + 1) ? this.finishOp(f2.assign, 2) : this.finishOp(f2.bitwiseXOR, 1);
    }, ce2.readToken_plus_min = function(e3) {
      var t3 = this.input.charCodeAt(this.pos + 1);
      return t3 === e3 ? 45 !== t3 || this.inModule || 62 !== this.input.charCodeAt(this.pos + 2) || 0 !== this.lastTokEnd && !m.test(this.input.slice(this.lastTokEnd, this.pos)) ? this.finishOp(f2.incDec, 2) : (this.skipLineComment(3), this.skipSpace(), this.nextToken()) : 61 === t3 ? this.finishOp(f2.assign, 2) : this.finishOp(f2.plusMin, 1);
    }, ce2.readToken_lt_gt = function(e3) {
      var t3 = this.input.charCodeAt(this.pos + 1), i3 = 1;
      return t3 === e3 ? (i3 = 62 === e3 && 62 === this.input.charCodeAt(this.pos + 2) ? 3 : 2, 61 === this.input.charCodeAt(this.pos + i3) ? this.finishOp(f2.assign, i3 + 1) : this.finishOp(f2.bitShift, i3)) : 33 !== t3 || 60 !== e3 || this.inModule || 45 !== this.input.charCodeAt(this.pos + 2) || 45 !== this.input.charCodeAt(this.pos + 3) ? (61 === t3 && (i3 = 2), this.finishOp(f2.relational, i3)) : (this.skipLineComment(4), this.skipSpace(), this.nextToken());
    }, ce2.readToken_eq_excl = function(e3) {
      var t3 = this.input.charCodeAt(this.pos + 1);
      return 61 === t3 ? this.finishOp(f2.equality, 61 === this.input.charCodeAt(this.pos + 2) ? 3 : 2) : 61 === e3 && 62 === t3 && this.options.ecmaVersion >= 6 ? (this.pos += 2, this.finishToken(f2.arrow)) : this.finishOp(61 === e3 ? f2.eq : f2.prefix, 1);
    }, ce2.readToken_question = function() {
      var e3 = this.options.ecmaVersion;
      if (e3 >= 11) {
        var t3 = this.input.charCodeAt(this.pos + 1);
        if (46 === t3) {
          var i3 = this.input.charCodeAt(this.pos + 2);
          if (i3 < 48 || i3 > 57) return this.finishOp(f2.questionDot, 2);
        }
        if (63 === t3) {
          if (e3 >= 12) {
            if (61 === this.input.charCodeAt(this.pos + 2)) return this.finishOp(f2.assign, 3);
          }
          return this.finishOp(f2.coalesce, 2);
        }
      }
      return this.finishOp(f2.question, 1);
    }, ce2.readToken_numberSign = function() {
      var e3 = 35;
      if (this.options.ecmaVersion >= 13 && (++this.pos, isIdentifierStart(e3 = this.fullCharCodeAtPos(), true) || 92 === e3)) return this.finishToken(f2.privateId, this.readWord1());
      this.raise(this.pos, "Unexpected character '" + codePointToString(e3) + "'");
    }, ce2.getTokenFromCode = function(e3) {
      switch (e3) {
        case 46:
          return this.readToken_dot();
        case 40:
          return ++this.pos, this.finishToken(f2.parenL);
        case 41:
          return ++this.pos, this.finishToken(f2.parenR);
        case 59:
          return ++this.pos, this.finishToken(f2.semi);
        case 44:
          return ++this.pos, this.finishToken(f2.comma);
        case 91:
          return ++this.pos, this.finishToken(f2.bracketL);
        case 93:
          return ++this.pos, this.finishToken(f2.bracketR);
        case 123:
          return ++this.pos, this.finishToken(f2.braceL);
        case 125:
          return ++this.pos, this.finishToken(f2.braceR);
        case 58:
          return ++this.pos, this.finishToken(f2.colon);
        case 96:
          if (this.options.ecmaVersion < 6) break;
          return ++this.pos, this.finishToken(f2.backQuote);
        case 48:
          var t3 = this.input.charCodeAt(this.pos + 1);
          if (120 === t3 || 88 === t3) return this.readRadixNumber(16);
          if (this.options.ecmaVersion >= 6) {
            if (111 === t3 || 79 === t3) return this.readRadixNumber(8);
            if (98 === t3 || 66 === t3) return this.readRadixNumber(2);
          }
        case 49:
        case 50:
        case 51:
        case 52:
        case 53:
        case 54:
        case 55:
        case 56:
        case 57:
          return this.readNumber(false);
        case 34:
        case 39:
          return this.readString(e3);
        case 47:
          return this.readToken_slash();
        case 37:
        case 42:
          return this.readToken_mult_modulo_exp(e3);
        case 124:
        case 38:
          return this.readToken_pipe_amp(e3);
        case 94:
          return this.readToken_caret();
        case 43:
        case 45:
          return this.readToken_plus_min(e3);
        case 60:
        case 62:
          return this.readToken_lt_gt(e3);
        case 61:
        case 33:
          return this.readToken_eq_excl(e3);
        case 63:
          return this.readToken_question();
        case 126:
          return this.finishOp(f2.prefix, 1);
        case 35:
          return this.readToken_numberSign();
      }
      this.raise(this.pos, "Unexpected character '" + codePointToString(e3) + "'");
    }, ce2.finishOp = function(e3, t3) {
      var i3 = this.input.slice(this.pos, this.pos + t3);
      return this.pos += t3, this.finishToken(e3, i3);
    }, ce2.readRegexp = function() {
      for (var e3, t3, i3 = this.pos; ; ) {
        this.pos >= this.input.length && this.raise(i3, "Unterminated regular expression");
        var s2 = this.input.charAt(this.pos);
        if (m.test(s2) && this.raise(i3, "Unterminated regular expression"), e3) e3 = false;
        else {
          if ("[" === s2) t3 = true;
          else if ("]" === s2 && t3) t3 = false;
          else if ("/" === s2 && !t3) break;
          e3 = "\\" === s2;
        }
        ++this.pos;
      }
      var r2 = this.input.slice(i3, this.pos);
      ++this.pos;
      var n3 = this.pos, a3 = this.readWord1();
      this.containsEsc && this.unexpected(n3);
      var o2 = this.regexpState || (this.regexpState = new acorn_RegExpValidationState(this));
      o2.reset(i3, r2, a3), this.validateRegExpFlags(o2), this.validateRegExpPattern(o2);
      var h3 = null;
      try {
        h3 = new RegExp(r2, a3);
      } catch (e4) {
      }
      return this.finishToken(f2.regexp, { pattern: r2, flags: a3, value: h3 });
    }, ce2.readInt = function(e3, t3, i3) {
      for (var s2 = this.options.ecmaVersion >= 12 && void 0 === t3, r2 = i3 && 48 === this.input.charCodeAt(this.pos), n3 = this.pos, a3 = 0, o2 = 0, h3 = 0, c3 = null == t3 ? 1 / 0 : t3; h3 < c3; ++h3, ++this.pos) {
        var p2 = this.input.charCodeAt(this.pos), l3 = void 0;
        if (s2 && 95 === p2) r2 && this.raiseRecoverable(this.pos, "Numeric separator is not allowed in legacy octal numeric literals"), 95 === o2 && this.raiseRecoverable(this.pos, "Numeric separator must be exactly one underscore"), 0 === h3 && this.raiseRecoverable(this.pos, "Numeric separator is not allowed at the first of digits"), o2 = p2;
        else {
          if ((l3 = p2 >= 97 ? p2 - 97 + 10 : p2 >= 65 ? p2 - 65 + 10 : p2 >= 48 && p2 <= 57 ? p2 - 48 : 1 / 0) >= e3) break;
          o2 = p2, a3 = a3 * e3 + l3;
        }
      }
      return s2 && 95 === o2 && this.raiseRecoverable(this.pos - 1, "Numeric separator is not allowed at the last of digits"), this.pos === n3 || null != t3 && this.pos - n3 !== t3 ? null : a3;
    }, ce2.readRadixNumber = function(e3) {
      var t3 = this.pos;
      this.pos += 2;
      var i3 = this.readInt(e3);
      return null == i3 && this.raise(this.start + 2, "Expected number in radix " + e3), this.options.ecmaVersion >= 11 && 110 === this.input.charCodeAt(this.pos) ? (i3 = stringToBigInt(this.input.slice(t3, this.pos)), ++this.pos) : isIdentifierStart(this.fullCharCodeAtPos()) && this.raise(this.pos, "Identifier directly after number"), this.finishToken(f2.num, i3);
    }, ce2.readNumber = function(e3) {
      var t3 = this.pos;
      e3 || null !== this.readInt(10, void 0, true) || this.raise(t3, "Invalid number");
      var i3 = this.pos - t3 >= 2 && 48 === this.input.charCodeAt(t3);
      i3 && this.strict && this.raise(t3, "Invalid number");
      var s2 = this.input.charCodeAt(this.pos);
      if (!i3 && !e3 && this.options.ecmaVersion >= 11 && 110 === s2) {
        var r2 = stringToBigInt(this.input.slice(t3, this.pos));
        return ++this.pos, isIdentifierStart(this.fullCharCodeAtPos()) && this.raise(this.pos, "Identifier directly after number"), this.finishToken(f2.num, r2);
      }
      i3 && /[89]/.test(this.input.slice(t3, this.pos)) && (i3 = false), 46 !== s2 || i3 || (++this.pos, this.readInt(10), s2 = this.input.charCodeAt(this.pos)), 69 !== s2 && 101 !== s2 || i3 || (43 !== (s2 = this.input.charCodeAt(++this.pos)) && 45 !== s2 || ++this.pos, null === this.readInt(10) && this.raise(t3, "Invalid number")), isIdentifierStart(this.fullCharCodeAtPos()) && this.raise(this.pos, "Identifier directly after number");
      var n3, a3 = (n3 = this.input.slice(t3, this.pos), i3 ? parseInt(n3, 8) : parseFloat(n3.replace(/_/g, "")));
      return this.finishToken(f2.num, a3);
    }, ce2.readCodePoint = function() {
      var e3;
      if (123 === this.input.charCodeAt(this.pos)) {
        this.options.ecmaVersion < 6 && this.unexpected();
        var t3 = ++this.pos;
        e3 = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos), ++this.pos, e3 > 1114111 && this.invalidStringToken(t3, "Code point out of bounds");
      } else e3 = this.readHexChar(4);
      return e3;
    }, ce2.readString = function(e3) {
      for (var t3 = "", i3 = ++this.pos; ; ) {
        this.pos >= this.input.length && this.raise(this.start, "Unterminated string constant");
        var s2 = this.input.charCodeAt(this.pos);
        if (s2 === e3) break;
        92 === s2 ? (t3 += this.input.slice(i3, this.pos), t3 += this.readEscapedChar(false), i3 = this.pos) : 8232 === s2 || 8233 === s2 ? (this.options.ecmaVersion < 10 && this.raise(this.start, "Unterminated string constant"), ++this.pos, this.options.locations && (this.curLine++, this.lineStart = this.pos)) : (isNewLine(s2) && this.raise(this.start, "Unterminated string constant"), ++this.pos);
      }
      return t3 += this.input.slice(i3, this.pos++), this.finishToken(f2.string, t3);
    };
    var pe2 = {};
    ce2.tryReadTemplateToken = function() {
      this.inTemplateElement = true;
      try {
        this.readTmplToken();
      } catch (e3) {
        if (e3 !== pe2) throw e3;
        this.readInvalidTemplateToken();
      }
      this.inTemplateElement = false;
    }, ce2.invalidStringToken = function(e3, t3) {
      if (this.inTemplateElement && this.options.ecmaVersion >= 9) throw pe2;
      this.raise(e3, t3);
    }, ce2.readTmplToken = function() {
      for (var e3 = "", t3 = this.pos; ; ) {
        this.pos >= this.input.length && this.raise(this.start, "Unterminated template");
        var i3 = this.input.charCodeAt(this.pos);
        if (96 === i3 || 36 === i3 && 123 === this.input.charCodeAt(this.pos + 1)) return this.pos !== this.start || this.type !== f2.template && this.type !== f2.invalidTemplate ? (e3 += this.input.slice(t3, this.pos), this.finishToken(f2.template, e3)) : 36 === i3 ? (this.pos += 2, this.finishToken(f2.dollarBraceL)) : (++this.pos, this.finishToken(f2.backQuote));
        if (92 === i3) e3 += this.input.slice(t3, this.pos), e3 += this.readEscapedChar(true), t3 = this.pos;
        else if (isNewLine(i3)) {
          switch (e3 += this.input.slice(t3, this.pos), ++this.pos, i3) {
            case 13:
              10 === this.input.charCodeAt(this.pos) && ++this.pos;
            case 10:
              e3 += "\n";
              break;
            default:
              e3 += String.fromCharCode(i3);
          }
          this.options.locations && (++this.curLine, this.lineStart = this.pos), t3 = this.pos;
        } else ++this.pos;
      }
    }, ce2.readInvalidTemplateToken = function() {
      for (; this.pos < this.input.length; this.pos++) switch (this.input[this.pos]) {
        case "\\":
          ++this.pos;
          break;
        case "$":
          if ("{" !== this.input[this.pos + 1]) break;
        case "`":
          return this.finishToken(f2.invalidTemplate, this.input.slice(this.start, this.pos));
        case "\r":
          "\n" === this.input[this.pos + 1] && ++this.pos;
        case "\n":
        case "\u2028":
        case "\u2029":
          ++this.curLine, this.lineStart = this.pos + 1;
      }
      this.raise(this.start, "Unterminated template");
    }, ce2.readEscapedChar = function(e3) {
      var t3 = this.input.charCodeAt(++this.pos);
      switch (++this.pos, t3) {
        case 110:
          return "\n";
        case 114:
          return "\r";
        case 120:
          return String.fromCharCode(this.readHexChar(2));
        case 117:
          return codePointToString(this.readCodePoint());
        case 116:
          return "	";
        case 98:
          return "\b";
        case 118:
          return "\v";
        case 102:
          return "\f";
        case 13:
          10 === this.input.charCodeAt(this.pos) && ++this.pos;
        case 10:
          return this.options.locations && (this.lineStart = this.pos, ++this.curLine), "";
        case 56:
        case 57:
          if (this.strict && this.invalidStringToken(this.pos - 1, "Invalid escape sequence"), e3) {
            var i3 = this.pos - 1;
            this.invalidStringToken(i3, "Invalid escape sequence in template string");
          }
        default:
          if (t3 >= 48 && t3 <= 55) {
            var s2 = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0], r2 = parseInt(s2, 8);
            return r2 > 255 && (s2 = s2.slice(0, -1), r2 = parseInt(s2, 8)), this.pos += s2.length - 1, t3 = this.input.charCodeAt(this.pos), "0" === s2 && 56 !== t3 && 57 !== t3 || !this.strict && !e3 || this.invalidStringToken(this.pos - 1 - s2.length, e3 ? "Octal literal in template string" : "Octal literal in strict mode"), String.fromCharCode(r2);
          }
          return isNewLine(t3) ? (this.options.locations && (this.lineStart = this.pos, ++this.curLine), "") : String.fromCharCode(t3);
      }
    }, ce2.readHexChar = function(e3) {
      var t3 = this.pos, i3 = this.readInt(16, e3);
      return null === i3 && this.invalidStringToken(t3, "Bad character escape sequence"), i3;
    }, ce2.readWord1 = function() {
      this.containsEsc = false;
      for (var e3 = "", t3 = true, i3 = this.pos, s2 = this.options.ecmaVersion >= 6; this.pos < this.input.length; ) {
        var r2 = this.fullCharCodeAtPos();
        if (isIdentifierChar(r2, s2)) this.pos += r2 <= 65535 ? 1 : 2;
        else {
          if (92 !== r2) break;
          this.containsEsc = true, e3 += this.input.slice(i3, this.pos);
          var n3 = this.pos;
          117 !== this.input.charCodeAt(++this.pos) && this.invalidStringToken(this.pos, "Expecting Unicode escape sequence \\uXXXX"), ++this.pos;
          var a3 = this.readCodePoint();
          (t3 ? isIdentifierStart : isIdentifierChar)(a3, s2) || this.invalidStringToken(n3, "Invalid Unicode escape"), e3 += codePointToString(a3), i3 = this.pos;
        }
        t3 = false;
      }
      return e3 + this.input.slice(i3, this.pos);
    }, ce2.readWord = function() {
      var e3 = this.readWord1(), t3 = f2.name;
      return this.keywords.test(e3) && (t3 = d2[e3]), this.finishToken(t3, e3);
    };
    acorn_Parser.acorn = { Parser: acorn_Parser, version: "8.15.0", defaultOptions: I, Position: acorn_Position, SourceLocation: acorn_SourceLocation, getLineInfo, Node: acorn_Node, TokenType: acorn_TokenType, tokTypes: f2, keywordTypes: d2, TokContext: acorn_TokContext, tokContexts: F2, isIdentifierChar, isIdentifierStart, Token: acorn_Token, isNewLine, lineBreak: m, lineBreakG: g2, nonASCIIwhitespace: x2 };
    const le = require$$1, ue2 = require$$2;
    const fe2 = /^\.?\//;
    function withTrailingSlash(e3 = "", t3) {
      return e3.endsWith("/") ? e3 : e3 + "/";
    }
    __name(withTrailingSlash, "withTrailingSlash");
    function isNonEmptyURL(e3) {
      return e3 && "/" !== e3;
    }
    __name(isNonEmptyURL, "isNonEmptyURL");
    function dist_joinURL(e3, ...t3) {
      let i3 = e3 || "";
      for (const e4 of t3.filter((e5) => isNonEmptyURL(e5))) if (i3) {
        const t4 = e4.replace(fe2, "");
        i3 = withTrailingSlash(i3) + t4;
      } else i3 = e4;
      return i3;
    }
    __name(dist_joinURL, "dist_joinURL");
    const me2 = /^[A-Za-z]:\//;
    function pathe_M_eThtNZ_normalizeWindowsPath(e3 = "") {
      return e3 ? e3.replace(/\\/g, "/").replace(me2, (e4) => e4.toUpperCase()) : e3;
    }
    __name(pathe_M_eThtNZ_normalizeWindowsPath, "pathe_M_eThtNZ_normalizeWindowsPath");
    const ge2 = /^[/\\]{2}/, xe2 = /^[/\\](?![/\\])|^[/\\]{2}(?!\.)|^[A-Za-z]:[/\\]/, ve = /^[A-Za-z]:$/, ye2 = /.(\.[^./]+|\.)$/, pathe_M_eThtNZ_normalize = /* @__PURE__ */ __name(function(e3) {
      if (0 === e3.length) return ".";
      const t3 = (e3 = pathe_M_eThtNZ_normalizeWindowsPath(e3)).match(ge2), i3 = isAbsolute(e3), s2 = "/" === e3[e3.length - 1];
      return 0 === (e3 = normalizeString(e3, !i3)).length ? i3 ? "/" : s2 ? "./" : "." : (s2 && (e3 += "/"), ve.test(e3) && (e3 += "/"), t3 ? i3 ? `//${e3}` : `//./${e3}` : i3 && !isAbsolute(e3) ? `/${e3}` : e3);
    }, "pathe_M_eThtNZ_normalize"), pathe_M_eThtNZ_join = /* @__PURE__ */ __name(function(...e3) {
      let t3 = "";
      for (const i3 of e3) if (i3) if (t3.length > 0) {
        const e4 = "/" === t3[t3.length - 1], s2 = "/" === i3[0];
        t3 += e4 && s2 ? i3.slice(1) : e4 || s2 ? i3 : `/${i3}`;
      } else t3 += i3;
      return pathe_M_eThtNZ_normalize(t3);
    }, "pathe_M_eThtNZ_join");
    function pathe_M_eThtNZ_cwd() {
      return "undefined" != typeof process && "function" == typeof process.cwd ? process.cwd().replace(/\\/g, "/") : "/";
    }
    __name(pathe_M_eThtNZ_cwd, "pathe_M_eThtNZ_cwd");
    const pathe_M_eThtNZ_resolve = /* @__PURE__ */ __name(function(...e3) {
      let t3 = "", i3 = false;
      for (let s2 = (e3 = e3.map((e4) => pathe_M_eThtNZ_normalizeWindowsPath(e4))).length - 1; s2 >= -1 && !i3; s2--) {
        const r2 = s2 >= 0 ? e3[s2] : pathe_M_eThtNZ_cwd();
        r2 && 0 !== r2.length && (t3 = `${r2}/${t3}`, i3 = isAbsolute(r2));
      }
      return t3 = normalizeString(t3, !i3), i3 && !isAbsolute(t3) ? `/${t3}` : t3.length > 0 ? t3 : ".";
    }, "pathe_M_eThtNZ_resolve");
    function normalizeString(e3, t3) {
      let i3 = "", s2 = 0, r2 = -1, n3 = 0, a3 = null;
      for (let o2 = 0; o2 <= e3.length; ++o2) {
        if (o2 < e3.length) a3 = e3[o2];
        else {
          if ("/" === a3) break;
          a3 = "/";
        }
        if ("/" === a3) {
          if (r2 === o2 - 1 || 1 === n3) ;
          else if (2 === n3) {
            if (i3.length < 2 || 2 !== s2 || "." !== i3[i3.length - 1] || "." !== i3[i3.length - 2]) {
              if (i3.length > 2) {
                const e4 = i3.lastIndexOf("/");
                -1 === e4 ? (i3 = "", s2 = 0) : (i3 = i3.slice(0, e4), s2 = i3.length - 1 - i3.lastIndexOf("/")), r2 = o2, n3 = 0;
                continue;
              }
              if (i3.length > 0) {
                i3 = "", s2 = 0, r2 = o2, n3 = 0;
                continue;
              }
            }
            t3 && (i3 += i3.length > 0 ? "/.." : "..", s2 = 2);
          } else i3.length > 0 ? i3 += `/${e3.slice(r2 + 1, o2)}` : i3 = e3.slice(r2 + 1, o2), s2 = o2 - r2 - 1;
          r2 = o2, n3 = 0;
        } else "." === a3 && -1 !== n3 ? ++n3 : n3 = -1;
      }
      return i3;
    }
    __name(normalizeString, "normalizeString");
    const isAbsolute = /* @__PURE__ */ __name(function(e3) {
      return xe2.test(e3);
    }, "isAbsolute"), extname = /* @__PURE__ */ __name(function(e3) {
      if (".." === e3) return "";
      const t3 = ye2.exec(pathe_M_eThtNZ_normalizeWindowsPath(e3));
      return t3 && t3[1] || "";
    }, "extname"), pathe_M_eThtNZ_dirname = /* @__PURE__ */ __name(function(e3) {
      const t3 = pathe_M_eThtNZ_normalizeWindowsPath(e3).replace(/\/$/, "").split("/").slice(0, -1);
      return 1 === t3.length && ve.test(t3[0]) && (t3[0] += "/"), t3.join("/") || (isAbsolute(e3) ? "/" : ".");
    }, "pathe_M_eThtNZ_dirname"), basename = /* @__PURE__ */ __name(function(e3, t3) {
      const i3 = pathe_M_eThtNZ_normalizeWindowsPath(e3).split("/");
      let s2 = "";
      for (let e4 = i3.length - 1; e4 >= 0; e4--) {
        const t4 = i3[e4];
        if (t4) {
          s2 = t4;
          break;
        }
      }
      return s2;
    }, "basename"), _e4 = require$$3, Ee2 = require$$4, be2 = require$$5$1, Se = require$$6, ke2 = require$$7, we2 = require$$8, Ie2 = new Set(le.builtinModules);
    function normalizeSlash(e3) {
      return e3.replace(/\\/g, "/");
    }
    __name(normalizeSlash, "normalizeSlash");
    const Ce2 = {}.hasOwnProperty, Re2 = /^([A-Z][a-z\d]*)+$/, Pe2 = /* @__PURE__ */ new Set(["string", "function", "number", "object", "Function", "Object", "boolean", "bigint", "symbol"]), Te = {};
    function formatList(e3, t3 = "and") {
      return e3.length < 3 ? e3.join(` ${t3} `) : `${e3.slice(0, -1).join(", ")}, ${t3} ${e3[e3.length - 1]}`;
    }
    __name(formatList, "formatList");
    const Ae = /* @__PURE__ */ new Map();
    let Ne2;
    function createError(e3, t3, i3) {
      return Ae.set(e3, t3), /* @__PURE__ */ function(e4, t4) {
        return NodeError;
        function NodeError(...i4) {
          const s2 = Error.stackTraceLimit;
          isErrorStackTraceLimitWritable() && (Error.stackTraceLimit = 0);
          const r2 = new e4();
          isErrorStackTraceLimitWritable() && (Error.stackTraceLimit = s2);
          const n3 = function(e5, t5, i5) {
            const s3 = Ae.get(e5);
            if (Ee2(void 0 !== s3, "expected `message` to be found"), "function" == typeof s3) return Ee2(s3.length <= t5.length, `Code: ${e5}; The provided arguments length (${t5.length}) does not match the required ones (${s3.length}).`), Reflect.apply(s3, i5, t5);
            const r3 = /%[dfijoOs]/g;
            let n4 = 0;
            for (; null !== r3.exec(s3); ) n4++;
            return Ee2(n4 === t5.length, `Code: ${e5}; The provided arguments length (${t5.length}) does not match the required ones (${n4}).`), 0 === t5.length ? s3 : (t5.unshift(s3), Reflect.apply(we2.format, null, t5));
          }(t4, i4, r2);
          return Object.defineProperties(r2, { message: { value: n3, enumerable: false, writable: true, configurable: true }, toString: { value() {
            return `${this.name} [${t4}]: ${this.message}`;
          }, enumerable: false, writable: true, configurable: true } }), Le2(r2), r2.code = t4, r2;
        }
        __name(NodeError, "NodeError");
      }(i3, e3);
    }
    __name(createError, "createError");
    function isErrorStackTraceLimitWritable() {
      try {
        if (ke2.startupSnapshot.isBuildingSnapshot()) return false;
      } catch {
      }
      const e3 = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
      return void 0 === e3 ? Object.isExtensible(Error) : Ce2.call(e3, "writable") && void 0 !== e3.writable ? e3.writable : void 0 !== e3.set;
    }
    __name(isErrorStackTraceLimitWritable, "isErrorStackTraceLimitWritable");
    Te.ERR_INVALID_ARG_TYPE = createError("ERR_INVALID_ARG_TYPE", (e3, t3, i3) => {
      Ee2("string" == typeof e3, "'name' must be a string"), Array.isArray(t3) || (t3 = [t3]);
      let s2 = "The ";
      if (e3.endsWith(" argument")) s2 += `${e3} `;
      else {
        const t4 = e3.includes(".") ? "property" : "argument";
        s2 += `"${e3}" ${t4} `;
      }
      s2 += "must be ";
      const r2 = [], n3 = [], a3 = [];
      for (const e4 of t3) Ee2("string" == typeof e4, "All expected entries have to be of type string"), Pe2.has(e4) ? r2.push(e4.toLowerCase()) : null === Re2.exec(e4) ? (Ee2("object" !== e4, 'The value "object" should be written as "Object"'), a3.push(e4)) : n3.push(e4);
      if (n3.length > 0) {
        const e4 = r2.indexOf("object");
        -1 !== e4 && (r2.slice(e4, 1), n3.push("Object"));
      }
      return r2.length > 0 && (s2 += `${r2.length > 1 ? "one of type" : "of type"} ${formatList(r2, "or")}`, (n3.length > 0 || a3.length > 0) && (s2 += " or ")), n3.length > 0 && (s2 += `an instance of ${formatList(n3, "or")}`, a3.length > 0 && (s2 += " or ")), a3.length > 0 && (a3.length > 1 ? s2 += `one of ${formatList(a3, "or")}` : (a3[0].toLowerCase() !== a3[0] && (s2 += "an "), s2 += `${a3[0]}`)), s2 += `. Received ${function(e4) {
        if (null == e4) return String(e4);
        if ("function" == typeof e4 && e4.name) return `function ${e4.name}`;
        if ("object" == typeof e4) return e4.constructor && e4.constructor.name ? `an instance of ${e4.constructor.name}` : `${(0, we2.inspect)(e4, { depth: -1 })}`;
        let t4 = (0, we2.inspect)(e4, { colors: false });
        t4.length > 28 && (t4 = `${t4.slice(0, 25)}...`);
        return `type ${typeof e4} (${t4})`;
      }(i3)}`, s2;
    }, TypeError), Te.ERR_INVALID_MODULE_SPECIFIER = createError("ERR_INVALID_MODULE_SPECIFIER", (e3, t3, i3 = void 0) => `Invalid module "${e3}" ${t3}${i3 ? ` imported from ${i3}` : ""}`, TypeError), Te.ERR_INVALID_PACKAGE_CONFIG = createError("ERR_INVALID_PACKAGE_CONFIG", (e3, t3, i3) => `Invalid package config ${e3}${t3 ? ` while importing ${t3}` : ""}${i3 ? `. ${i3}` : ""}`, Error), Te.ERR_INVALID_PACKAGE_TARGET = createError("ERR_INVALID_PACKAGE_TARGET", (e3, t3, i3, s2 = false, r2 = void 0) => {
      const n3 = "string" == typeof i3 && !s2 && i3.length > 0 && !i3.startsWith("./");
      return "." === t3 ? (Ee2(false === s2), `Invalid "exports" main target ${JSON.stringify(i3)} defined in the package config ${e3}package.json${r2 ? ` imported from ${r2}` : ""}${n3 ? '; targets must start with "./"' : ""}`) : `Invalid "${s2 ? "imports" : "exports"}" target ${JSON.stringify(i3)} defined for '${t3}' in the package config ${e3}package.json${r2 ? ` imported from ${r2}` : ""}${n3 ? '; targets must start with "./"' : ""}`;
    }, Error), Te.ERR_MODULE_NOT_FOUND = createError("ERR_MODULE_NOT_FOUND", (e3, t3, i3 = false) => `Cannot find ${i3 ? "module" : "package"} '${e3}' imported from ${t3}`, Error), Te.ERR_NETWORK_IMPORT_DISALLOWED = createError("ERR_NETWORK_IMPORT_DISALLOWED", "import of '%s' by %s is not supported: %s", Error), Te.ERR_PACKAGE_IMPORT_NOT_DEFINED = createError("ERR_PACKAGE_IMPORT_NOT_DEFINED", (e3, t3, i3) => `Package import specifier "${e3}" is not defined${t3 ? ` in package ${t3}package.json` : ""} imported from ${i3}`, TypeError), Te.ERR_PACKAGE_PATH_NOT_EXPORTED = createError("ERR_PACKAGE_PATH_NOT_EXPORTED", (e3, t3, i3 = void 0) => "." === t3 ? `No "exports" main defined in ${e3}package.json${i3 ? ` imported from ${i3}` : ""}` : `Package subpath '${t3}' is not defined by "exports" in ${e3}package.json${i3 ? ` imported from ${i3}` : ""}`, Error), Te.ERR_UNSUPPORTED_DIR_IMPORT = createError("ERR_UNSUPPORTED_DIR_IMPORT", "Directory import '%s' is not supported resolving ES modules imported from %s", Error), Te.ERR_UNSUPPORTED_RESOLVE_REQUEST = createError("ERR_UNSUPPORTED_RESOLVE_REQUEST", 'Failed to resolve module specifier "%s" from "%s": Invalid relative URL or base scheme is not hierarchical.', TypeError), Te.ERR_UNKNOWN_FILE_EXTENSION = createError("ERR_UNKNOWN_FILE_EXTENSION", (e3, t3) => `Unknown file extension "${e3}" for ${t3}`, TypeError), Te.ERR_INVALID_ARG_VALUE = createError("ERR_INVALID_ARG_VALUE", (e3, t3, i3 = "is invalid") => {
      let s2 = (0, we2.inspect)(t3);
      s2.length > 128 && (s2 = `${s2.slice(0, 128)}...`);
      return `The ${e3.includes(".") ? "property" : "argument"} '${e3}' ${i3}. Received ${s2}`;
    }, TypeError);
    const Le2 = function(e3) {
      const t3 = "__node_internal_" + e3.name;
      return Object.defineProperty(e3, "name", { value: t3 }), e3;
    }(function(e3) {
      const t3 = isErrorStackTraceLimitWritable();
      return t3 && (Ne2 = Error.stackTraceLimit, Error.stackTraceLimit = Number.POSITIVE_INFINITY), Error.captureStackTrace(e3), t3 && (Error.stackTraceLimit = Ne2), e3;
    });
    const Oe2 = {}.hasOwnProperty, { ERR_INVALID_PACKAGE_CONFIG: De2 } = Te, Ve = /* @__PURE__ */ new Map();
    function read(e3, { base: t3, specifier: i3 }) {
      const s2 = Ve.get(e3);
      if (s2) return s2;
      let r2;
      try {
        r2 = ue2.readFileSync(Se.toNamespacedPath(e3), "utf8");
      } catch (e4) {
        const t4 = e4;
        if ("ENOENT" !== t4.code) throw t4;
      }
      const n3 = { exists: false, pjsonPath: e3, main: void 0, name: void 0, type: "none", exports: void 0, imports: void 0 };
      if (void 0 !== r2) {
        let s3;
        try {
          s3 = JSON.parse(r2);
        } catch (s4) {
          const r3 = s4, n4 = new De2(e3, (t3 ? `"${i3}" from ` : "") + (0, _e4.fileURLToPath)(t3 || i3), r3.message);
          throw n4.cause = r3, n4;
        }
        n3.exists = true, Oe2.call(s3, "name") && "string" == typeof s3.name && (n3.name = s3.name), Oe2.call(s3, "main") && "string" == typeof s3.main && (n3.main = s3.main), Oe2.call(s3, "exports") && (n3.exports = s3.exports), Oe2.call(s3, "imports") && (n3.imports = s3.imports), !Oe2.call(s3, "type") || "commonjs" !== s3.type && "module" !== s3.type || (n3.type = s3.type);
      }
      return Ve.set(e3, n3), n3;
    }
    __name(read, "read");
    function getPackageScopeConfig(e3) {
      let t3 = new URL("package.json", e3);
      for (; ; ) {
        if (t3.pathname.endsWith("node_modules/package.json")) break;
        const i3 = read((0, _e4.fileURLToPath)(t3), { specifier: e3 });
        if (i3.exists) return i3;
        const s2 = t3;
        if (t3 = new URL("../package.json", t3), t3.pathname === s2.pathname) break;
      }
      return { pjsonPath: (0, _e4.fileURLToPath)(t3), exists: false, type: "none" };
    }
    __name(getPackageScopeConfig, "getPackageScopeConfig");
    function getPackageType(e3) {
      return getPackageScopeConfig(e3).type;
    }
    __name(getPackageType, "getPackageType");
    const { ERR_UNKNOWN_FILE_EXTENSION: Ue2 } = Te, Me2 = {}.hasOwnProperty, je2 = { __proto__: null, ".cjs": "commonjs", ".js": "module", ".json": "json", ".mjs": "module" };
    const Fe2 = { __proto__: null, "data:": /* @__PURE__ */ __name(function(e3) {
      const { 1: t3 } = /^([^/]+\/[^;,]+)[^,]*?(;base64)?,/.exec(e3.pathname) || [null, null, null];
      return function(e4) {
        return e4 && /\s*(text|application)\/javascript\s*(;\s*charset=utf-?8\s*)?/i.test(e4) ? "module" : "application/json" === e4 ? "json" : null;
      }(t3);
    }, "data:"), "file:": /* @__PURE__ */ __name(function(e3, t3, i3) {
      const s2 = function(e4) {
        const t4 = e4.pathname;
        let i4 = t4.length;
        for (; i4--; ) {
          const e5 = t4.codePointAt(i4);
          if (47 === e5) return "";
          if (46 === e5) return 47 === t4.codePointAt(i4 - 1) ? "" : t4.slice(i4);
        }
        return "";
      }(e3);
      if (".js" === s2) {
        const t4 = getPackageType(e3);
        return "none" !== t4 ? t4 : "commonjs";
      }
      if ("" === s2) {
        const t4 = getPackageType(e3);
        return "none" === t4 || "commonjs" === t4 ? "commonjs" : "module";
      }
      const r2 = je2[s2];
      if (r2) return r2;
      if (i3) return;
      const n3 = (0, _e4.fileURLToPath)(e3);
      throw new Ue2(s2, n3);
    }, "file:"), "http:": getHttpProtocolModuleFormat, "https:": getHttpProtocolModuleFormat, "node:": /* @__PURE__ */ __name(() => "builtin", "node:") };
    function getHttpProtocolModuleFormat() {
    }
    __name(getHttpProtocolModuleFormat, "getHttpProtocolModuleFormat");
    const Be = RegExp.prototype[Symbol.replace], { ERR_INVALID_MODULE_SPECIFIER: $e2, ERR_INVALID_PACKAGE_CONFIG: qe, ERR_INVALID_PACKAGE_TARGET: We, ERR_MODULE_NOT_FOUND: Ge, ERR_PACKAGE_IMPORT_NOT_DEFINED: He, ERR_PACKAGE_PATH_NOT_EXPORTED: Ke2, ERR_UNSUPPORTED_DIR_IMPORT: ze2, ERR_UNSUPPORTED_RESOLVE_REQUEST: Je } = Te, Ye = {}.hasOwnProperty, Qe = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))?(\\|\/|$)/i, Ze = /(^|\\|\/)((\.|%2e)(\.|%2e)?|(n|%6e|%4e)(o|%6f|%4f)(d|%64|%44)(e|%65|%45)(_|%5f)(m|%6d|%4d)(o|%6f|%4f)(d|%64|%44)(u|%75|%55)(l|%6c|%4c)(e|%65|%45)(s|%73|%53))(\\|\/|$)/i, Xe = /^\.|%|\\/, et2 = /\*/g, tt2 = /%2f|%5c/i, it2 = /* @__PURE__ */ new Set(), st = /[/\\]{2}/;
    function emitInvalidSegmentDeprecation(e3, t3, i3, s2, r2, n3, a3) {
      if (be2.noDeprecation) return;
      const o2 = (0, _e4.fileURLToPath)(s2), h3 = null !== st.exec(a3 ? e3 : t3);
      be2.emitWarning(`Use of deprecated ${h3 ? "double slash" : "leading or trailing slash matching"} resolving "${e3}" for module request "${t3}" ${t3 === i3 ? "" : `matched to "${i3}" `}in the "${r2 ? "imports" : "exports"}" field module resolution of the package at ${o2}${n3 ? ` imported from ${(0, _e4.fileURLToPath)(n3)}` : ""}.`, "DeprecationWarning", "DEP0166");
    }
    __name(emitInvalidSegmentDeprecation, "emitInvalidSegmentDeprecation");
    function emitLegacyIndexDeprecation(e3, t3, i3, s2) {
      if (be2.noDeprecation) return;
      const r2 = function(e4, t4) {
        const i4 = e4.protocol;
        return Me2.call(Fe2, i4) && Fe2[i4](e4, t4, true) || null;
      }(e3, { parentURL: i3.href });
      if ("module" !== r2) return;
      const n3 = (0, _e4.fileURLToPath)(e3.href), a3 = (0, _e4.fileURLToPath)(new _e4.URL(".", t3)), o2 = (0, _e4.fileURLToPath)(i3);
      s2 ? Se.resolve(a3, s2) !== n3 && be2.emitWarning(`Package ${a3} has a "main" field set to "${s2}", excluding the full filename and extension to the resolved file at "${n3.slice(a3.length)}", imported from ${o2}.
 Automatic extension resolution of the "main" field is deprecated for ES modules.`, "DeprecationWarning", "DEP0151") : be2.emitWarning(`No "main" or "exports" field defined in the package.json for ${a3} resolving the main entry point "${n3.slice(a3.length)}", imported from ${o2}.
Default "index" lookups for the main are deprecated for ES modules.`, "DeprecationWarning", "DEP0151");
    }
    __name(emitLegacyIndexDeprecation, "emitLegacyIndexDeprecation");
    function tryStatSync(e3) {
      try {
        return (0, ue2.statSync)(e3);
      } catch {
      }
    }
    __name(tryStatSync, "tryStatSync");
    function fileExists(e3) {
      const t3 = (0, ue2.statSync)(e3, { throwIfNoEntry: false }), i3 = t3 ? t3.isFile() : void 0;
      return null != i3 && i3;
    }
    __name(fileExists, "fileExists");
    function legacyMainResolve(e3, t3, i3) {
      let s2;
      if (void 0 !== t3.main) {
        if (s2 = new _e4.URL(t3.main, e3), fileExists(s2)) return s2;
        const r3 = [`./${t3.main}.js`, `./${t3.main}.json`, `./${t3.main}.node`, `./${t3.main}/index.js`, `./${t3.main}/index.json`, `./${t3.main}/index.node`];
        let n4 = -1;
        for (; ++n4 < r3.length && (s2 = new _e4.URL(r3[n4], e3), !fileExists(s2)); ) s2 = void 0;
        if (s2) return emitLegacyIndexDeprecation(s2, e3, i3, t3.main), s2;
      }
      const r2 = ["./index.js", "./index.json", "./index.node"];
      let n3 = -1;
      for (; ++n3 < r2.length && (s2 = new _e4.URL(r2[n3], e3), !fileExists(s2)); ) s2 = void 0;
      if (s2) return emitLegacyIndexDeprecation(s2, e3, i3, t3.main), s2;
      throw new Ge((0, _e4.fileURLToPath)(new _e4.URL(".", e3)), (0, _e4.fileURLToPath)(i3));
    }
    __name(legacyMainResolve, "legacyMainResolve");
    function exportsNotFound(e3, t3, i3) {
      return new Ke2((0, _e4.fileURLToPath)(new _e4.URL(".", t3)), e3, i3 && (0, _e4.fileURLToPath)(i3));
    }
    __name(exportsNotFound, "exportsNotFound");
    function invalidPackageTarget(e3, t3, i3, s2, r2) {
      return t3 = "object" == typeof t3 && null !== t3 ? JSON.stringify(t3, null, "") : `${t3}`, new We((0, _e4.fileURLToPath)(new _e4.URL(".", i3)), e3, t3, s2, r2 && (0, _e4.fileURLToPath)(r2));
    }
    __name(invalidPackageTarget, "invalidPackageTarget");
    function resolvePackageTargetString(e3, t3, i3, s2, r2, n3, a3, o2, h3) {
      if ("" !== t3 && !n3 && "/" !== e3[e3.length - 1]) throw invalidPackageTarget(i3, e3, s2, a3, r2);
      if (!e3.startsWith("./")) {
        if (a3 && !e3.startsWith("../") && !e3.startsWith("/")) {
          let i4 = false;
          try {
            new _e4.URL(e3), i4 = true;
          } catch {
          }
          if (!i4) {
            return packageResolve(n3 ? Be.call(et2, e3, () => t3) : e3 + t3, s2, h3);
          }
        }
        throw invalidPackageTarget(i3, e3, s2, a3, r2);
      }
      if (null !== Qe.exec(e3.slice(2))) {
        if (null !== Ze.exec(e3.slice(2))) throw invalidPackageTarget(i3, e3, s2, a3, r2);
        if (!o2) {
          const o3 = n3 ? i3.replace("*", () => t3) : i3 + t3;
          emitInvalidSegmentDeprecation(n3 ? Be.call(et2, e3, () => t3) : e3, o3, i3, s2, a3, r2, true);
        }
      }
      const c3 = new _e4.URL(e3, s2), p2 = c3.pathname, l3 = new _e4.URL(".", s2).pathname;
      if (!p2.startsWith(l3)) throw invalidPackageTarget(i3, e3, s2, a3, r2);
      if ("" === t3) return c3;
      if (null !== Qe.exec(t3)) {
        const h4 = n3 ? i3.replace("*", () => t3) : i3 + t3;
        if (null === Ze.exec(t3)) {
          if (!o2) {
            emitInvalidSegmentDeprecation(n3 ? Be.call(et2, e3, () => t3) : e3, h4, i3, s2, a3, r2, false);
          }
        } else !function(e4, t4, i4, s3, r3) {
          const n4 = `request is not a valid match in pattern "${t4}" for the "${s3 ? "imports" : "exports"}" resolution of ${(0, _e4.fileURLToPath)(i4)}`;
          throw new $e2(e4, n4, r3 && (0, _e4.fileURLToPath)(r3));
        }(h4, i3, s2, a3, r2);
      }
      return n3 ? new _e4.URL(Be.call(et2, c3.href, () => t3)) : new _e4.URL(t3, c3);
    }
    __name(resolvePackageTargetString, "resolvePackageTargetString");
    function isArrayIndex(e3) {
      const t3 = Number(e3);
      return `${t3}` === e3 && (t3 >= 0 && t3 < 4294967295);
    }
    __name(isArrayIndex, "isArrayIndex");
    function resolvePackageTarget(e3, t3, i3, s2, r2, n3, a3, o2, h3) {
      if ("string" == typeof t3) return resolvePackageTargetString(t3, i3, s2, e3, r2, n3, a3, o2, h3);
      if (Array.isArray(t3)) {
        const c3 = t3;
        if (0 === c3.length) return null;
        let p2, l3 = -1;
        for (; ++l3 < c3.length; ) {
          const t4 = c3[l3];
          let u3;
          try {
            u3 = resolvePackageTarget(e3, t4, i3, s2, r2, n3, a3, o2, h3);
          } catch (e4) {
            if (p2 = e4, "ERR_INVALID_PACKAGE_TARGET" === e4.code) continue;
            throw e4;
          }
          if (void 0 !== u3) {
            if (null !== u3) return u3;
            p2 = null;
          }
        }
        if (null == p2) return null;
        throw p2;
      }
      if ("object" == typeof t3 && null !== t3) {
        const c3 = Object.getOwnPropertyNames(t3);
        let p2 = -1;
        for (; ++p2 < c3.length; ) {
          if (isArrayIndex(c3[p2])) throw new qe((0, _e4.fileURLToPath)(e3), r2, '"exports" cannot contain numeric property keys.');
        }
        for (p2 = -1; ++p2 < c3.length; ) {
          const l3 = c3[p2];
          if ("default" === l3 || h3 && h3.has(l3)) {
            const c4 = resolvePackageTarget(e3, t3[l3], i3, s2, r2, n3, a3, o2, h3);
            if (void 0 === c4) continue;
            return c4;
          }
        }
        return null;
      }
      if (null === t3) return null;
      throw invalidPackageTarget(s2, t3, e3, a3, r2);
    }
    __name(resolvePackageTarget, "resolvePackageTarget");
    function emitTrailingSlashPatternDeprecation(e3, t3, i3) {
      if (be2.noDeprecation) return;
      const s2 = (0, _e4.fileURLToPath)(t3);
      it2.has(s2 + "|" + e3) || (it2.add(s2 + "|" + e3), be2.emitWarning(`Use of deprecated trailing slash pattern mapping "${e3}" in the "exports" field module resolution of the package at ${s2}${i3 ? ` imported from ${(0, _e4.fileURLToPath)(i3)}` : ""}. Mapping specifiers ending in "/" is no longer supported.`, "DeprecationWarning", "DEP0155"));
    }
    __name(emitTrailingSlashPatternDeprecation, "emitTrailingSlashPatternDeprecation");
    function packageExportsResolve(e3, t3, i3, s2, r2) {
      let n3 = i3.exports;
      if (function(e4, t4, i4) {
        if ("string" == typeof e4 || Array.isArray(e4)) return true;
        if ("object" != typeof e4 || null === e4) return false;
        const s3 = Object.getOwnPropertyNames(e4);
        let r3 = false, n4 = 0, a4 = -1;
        for (; ++a4 < s3.length; ) {
          const e5 = s3[a4], o3 = "" === e5 || "." !== e5[0];
          if (0 === n4++) r3 = o3;
          else if (r3 !== o3) throw new qe((0, _e4.fileURLToPath)(t4), i4, `"exports" cannot contain some keys starting with '.' and some not. The exports object must either be an object of package subpath keys or an object of main entry condition name keys only.`);
        }
        return r3;
      }(n3, e3, s2) && (n3 = { ".": n3 }), Ye.call(n3, t3) && !t3.includes("*") && !t3.endsWith("/")) {
        const i4 = resolvePackageTarget(e3, n3[t3], "", t3, s2, false, false, false, r2);
        if (null == i4) throw exportsNotFound(t3, e3, s2);
        return i4;
      }
      let a3 = "", o2 = "";
      const h3 = Object.getOwnPropertyNames(n3);
      let c3 = -1;
      for (; ++c3 < h3.length; ) {
        const i4 = h3[c3], r3 = i4.indexOf("*");
        if (-1 !== r3 && t3.startsWith(i4.slice(0, r3))) {
          t3.endsWith("/") && emitTrailingSlashPatternDeprecation(t3, e3, s2);
          const n4 = i4.slice(r3 + 1);
          t3.length >= i4.length && t3.endsWith(n4) && 1 === patternKeyCompare(a3, i4) && i4.lastIndexOf("*") === r3 && (a3 = i4, o2 = t3.slice(r3, t3.length - n4.length));
        }
      }
      if (a3) {
        const i4 = resolvePackageTarget(e3, n3[a3], o2, a3, s2, true, false, t3.endsWith("/"), r2);
        if (null == i4) throw exportsNotFound(t3, e3, s2);
        return i4;
      }
      throw exportsNotFound(t3, e3, s2);
    }
    __name(packageExportsResolve, "packageExportsResolve");
    function patternKeyCompare(e3, t3) {
      const i3 = e3.indexOf("*"), s2 = t3.indexOf("*"), r2 = -1 === i3 ? e3.length : i3 + 1, n3 = -1 === s2 ? t3.length : s2 + 1;
      return r2 > n3 ? -1 : n3 > r2 || -1 === i3 ? 1 : -1 === s2 || e3.length > t3.length ? -1 : t3.length > e3.length ? 1 : 0;
    }
    __name(patternKeyCompare, "patternKeyCompare");
    function packageImportsResolve(e3, t3, i3) {
      if ("#" === e3 || e3.startsWith("#/") || e3.endsWith("/")) {
        throw new $e2(e3, "is not a valid internal imports specifier name", (0, _e4.fileURLToPath)(t3));
      }
      let s2;
      const r2 = getPackageScopeConfig(t3);
      if (r2.exists) {
        s2 = (0, _e4.pathToFileURL)(r2.pjsonPath);
        const n3 = r2.imports;
        if (n3) if (Ye.call(n3, e3) && !e3.includes("*")) {
          const r3 = resolvePackageTarget(s2, n3[e3], "", e3, t3, false, true, false, i3);
          if (null != r3) return r3;
        } else {
          let r3 = "", a3 = "";
          const o2 = Object.getOwnPropertyNames(n3);
          let h3 = -1;
          for (; ++h3 < o2.length; ) {
            const t4 = o2[h3], i4 = t4.indexOf("*");
            if (-1 !== i4 && e3.startsWith(t4.slice(0, -1))) {
              const s3 = t4.slice(i4 + 1);
              e3.length >= t4.length && e3.endsWith(s3) && 1 === patternKeyCompare(r3, t4) && t4.lastIndexOf("*") === i4 && (r3 = t4, a3 = e3.slice(i4, e3.length - s3.length));
            }
          }
          if (r3) {
            const e4 = resolvePackageTarget(s2, n3[r3], a3, r3, t3, true, true, false, i3);
            if (null != e4) return e4;
          }
        }
      }
      throw function(e4, t4, i4) {
        return new He(e4, t4 && (0, _e4.fileURLToPath)(new _e4.URL(".", t4)), (0, _e4.fileURLToPath)(i4));
      }(e3, s2, t3);
    }
    __name(packageImportsResolve, "packageImportsResolve");
    function packageResolve(e3, t3, i3) {
      if (le.builtinModules.includes(e3)) return new _e4.URL("node:" + e3);
      const { packageName: s2, packageSubpath: r2, isScoped: n3 } = function(e4, t4) {
        let i4 = e4.indexOf("/"), s3 = true, r3 = false;
        "@" === e4[0] && (r3 = true, -1 === i4 || 0 === e4.length ? s3 = false : i4 = e4.indexOf("/", i4 + 1));
        const n4 = -1 === i4 ? e4 : e4.slice(0, i4);
        if (null !== Xe.exec(n4) && (s3 = false), !s3) throw new $e2(e4, "is not a valid package name", (0, _e4.fileURLToPath)(t4));
        return { packageName: n4, packageSubpath: "." + (-1 === i4 ? "" : e4.slice(i4)), isScoped: r3 };
      }(e3, t3), a3 = getPackageScopeConfig(t3);
      if (a3.exists) {
        const e4 = (0, _e4.pathToFileURL)(a3.pjsonPath);
        if (a3.name === s2 && void 0 !== a3.exports && null !== a3.exports) return packageExportsResolve(e4, r2, a3, t3, i3);
      }
      let o2, h3 = new _e4.URL("./node_modules/" + s2 + "/package.json", t3), c3 = (0, _e4.fileURLToPath)(h3);
      do {
        const a4 = tryStatSync(c3.slice(0, -13));
        if (!a4 || !a4.isDirectory()) {
          o2 = c3, h3 = new _e4.URL((n3 ? "../../../../node_modules/" : "../../../node_modules/") + s2 + "/package.json", h3), c3 = (0, _e4.fileURLToPath)(h3);
          continue;
        }
        const p2 = read(c3, { base: t3, specifier: e3 });
        return void 0 !== p2.exports && null !== p2.exports ? packageExportsResolve(h3, r2, p2, t3, i3) : "." === r2 ? legacyMainResolve(h3, p2, t3) : new _e4.URL(r2, h3);
      } while (c3.length !== o2.length);
      throw new Ge(s2, (0, _e4.fileURLToPath)(t3), false);
    }
    __name(packageResolve, "packageResolve");
    function moduleResolve(e3, t3, i3, s2) {
      const r2 = t3.protocol, n3 = "data:" === r2 || "http:" === r2 || "https:" === r2;
      let a3;
      if (function(e4) {
        return "" !== e4 && ("/" === e4[0] || function(e5) {
          if ("." === e5[0]) {
            if (1 === e5.length || "/" === e5[1]) return true;
            if ("." === e5[1] && (2 === e5.length || "/" === e5[2])) return true;
          }
          return false;
        }(e4));
      }(e3)) try {
        a3 = new _e4.URL(e3, t3);
      } catch (i4) {
        const s3 = new Je(e3, t3);
        throw s3.cause = i4, s3;
      }
      else if ("file:" === r2 && "#" === e3[0]) a3 = packageImportsResolve(e3, t3, i3);
      else try {
        a3 = new _e4.URL(e3);
      } catch (s3) {
        if (n3 && !le.builtinModules.includes(e3)) {
          const i4 = new Je(e3, t3);
          throw i4.cause = s3, i4;
        }
        a3 = packageResolve(e3, t3, i3);
      }
      return Ee2(void 0 !== a3, "expected to be defined"), "file:" !== a3.protocol ? a3 : function(e4, t4) {
        if (null !== tt2.exec(e4.pathname)) throw new $e2(e4.pathname, 'must not include encoded "/" or "\\" characters', (0, _e4.fileURLToPath)(t4));
        let i4;
        try {
          i4 = (0, _e4.fileURLToPath)(e4);
        } catch (i5) {
          const s4 = i5;
          throw Object.defineProperty(s4, "input", { value: String(e4) }), Object.defineProperty(s4, "module", { value: String(t4) }), s4;
        }
        const s3 = tryStatSync(i4.endsWith("/") ? i4.slice(-1) : i4);
        if (s3 && s3.isDirectory()) {
          const s4 = new ze2(i4, (0, _e4.fileURLToPath)(t4));
          throw s4.url = String(e4), s4;
        }
        if (!s3 || !s3.isFile()) {
          const s4 = new Ge(i4 || e4.pathname, t4 && (0, _e4.fileURLToPath)(t4), true);
          throw s4.url = String(e4), s4;
        }
        {
          const t5 = (0, ue2.realpathSync)(i4), { search: s4, hash: r3 } = e4;
          (e4 = (0, _e4.pathToFileURL)(t5 + (i4.endsWith(Se.sep) ? "/" : ""))).search = s4, e4.hash = r3;
        }
        return e4;
      }(a3, t3);
    }
    __name(moduleResolve, "moduleResolve");
    function fileURLToPath(e3) {
      return "string" != typeof e3 || e3.startsWith("file://") ? normalizeSlash((0, _e4.fileURLToPath)(e3)) : normalizeSlash(e3);
    }
    __name(fileURLToPath, "fileURLToPath");
    function pathToFileURL2(e3) {
      return (0, _e4.pathToFileURL)(fileURLToPath(e3)).toString();
    }
    __name(pathToFileURL2, "pathToFileURL");
    const rt2 = /* @__PURE__ */ new Set(["node", "import"]), nt2 = [".mjs", ".cjs", ".js", ".json"], at = /* @__PURE__ */ new Set(["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT", "MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"]);
    function _tryModuleResolve(e3, t3, i3) {
      try {
        return moduleResolve(e3, t3, i3);
      } catch (e4) {
        if (!at.has(e4 == null ? void 0 : e4.code)) throw e4;
      }
    }
    __name(_tryModuleResolve, "_tryModuleResolve");
    function _resolve(e3, t3 = {}) {
      if ("string" != typeof e3) {
        if (!(e3 instanceof URL)) throw new TypeError("input must be a `string` or `URL`");
        e3 = fileURLToPath(e3);
      }
      if (/(?:node|data|http|https):/.test(e3)) return e3;
      if (Ie2.has(e3)) return "node:" + e3;
      if (e3.startsWith("file://") && (e3 = fileURLToPath(e3)), isAbsolute(e3)) try {
        if ((0, ue2.statSync)(e3).isFile()) return pathToFileURL2(e3);
      } catch (e4) {
        if ("ENOENT" !== (e4 == null ? void 0 : e4.code)) throw e4;
      }
      const i3 = t3.conditions ? new Set(t3.conditions) : rt2, s2 = (Array.isArray(t3.url) ? t3.url : [t3.url]).filter(Boolean).map((e4) => new URL(function(e5) {
        return "string" != typeof e5 && (e5 = e5.toString()), /(?:node|data|http|https|file):/.test(e5) ? e5 : Ie2.has(e5) ? "node:" + e5 : "file://" + encodeURI(normalizeSlash(e5));
      }(e4.toString())));
      0 === s2.length && s2.push(new URL(pathToFileURL2(process.cwd())));
      const r2 = [...s2];
      for (const e4 of s2) "file:" === e4.protocol && r2.push(new URL("./", e4), new URL(dist_joinURL(e4.pathname, "_index.js"), e4), new URL("node_modules", e4));
      let n3;
      for (const s3 of r2) {
        if (n3 = _tryModuleResolve(e3, s3, i3), n3) break;
        for (const r3 of ["", "/index"]) {
          for (const a3 of t3.extensions || nt2) if (n3 = _tryModuleResolve(dist_joinURL(e3, r3) + a3, s3, i3), n3) break;
          if (n3) break;
        }
        if (n3) break;
      }
      if (!n3) {
        const t4 = new Error(`Cannot find module ${e3} imported from ${r2.join(", ")}`);
        throw t4.code = "ERR_MODULE_NOT_FOUND", t4;
      }
      return pathToFileURL2(n3);
    }
    __name(_resolve, "_resolve");
    function resolveSync2(e3, t3) {
      return _resolve(e3, t3);
    }
    __name(resolveSync2, "resolveSync");
    function resolvePathSync(e3, t3) {
      return fileURLToPath(resolveSync2(e3, t3));
    }
    __name(resolvePathSync, "resolvePathSync");
    const ot2 = /(?:[\s;]|^)(?:import[\s\w*,{}]*from|import\s*["'*{]|export\b\s*(?:[*{]|default|class|type|function|const|var|let|async function)|import\.meta\b)/m, ht2 = /\/\*.+?\*\/|\/\/.*(?=[nr])/g;
    function hasESMSyntax(e3, t3 = {}) {
      return t3.stripComments && (e3 = e3.replace(ht2, "")), ot2.test(e3);
    }
    __name(hasESMSyntax, "hasESMSyntax");
    function escapeStringRegexp(e3) {
      if ("string" != typeof e3) throw new TypeError("Expected a string");
      return e3.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
    }
    __name(escapeStringRegexp, "escapeStringRegexp");
    const ct2 = /* @__PURE__ */ new Set(["/", "\\", void 0]), pt2 = Symbol.for("pathe:normalizedAlias"), lt = /[/\\]/;
    function normalizeAliases(e3) {
      var _a3;
      if (e3[pt2]) return e3;
      const t3 = Object.fromEntries(Object.entries(e3).sort(([e4], [t4]) => function(e5, t5) {
        return t5.split("/").length - e5.split("/").length;
      }(e4, t4)));
      for (const e4 in t3) for (const i3 in t3) i3 === e4 || e4.startsWith(i3) || ((_a3 = t3[e4]) == null ? void 0 : _a3.startsWith(i3)) && ct2.has(t3[e4][i3.length]) && (t3[e4] = t3[i3] + t3[e4].slice(i3.length));
      return Object.defineProperty(t3, pt2, { value: true, enumerable: false }), t3;
    }
    __name(normalizeAliases, "normalizeAliases");
    function utils_hasTrailingSlash(e3 = "/") {
      const t3 = e3[e3.length - 1];
      return "/" === t3 || "\\" === t3;
    }
    __name(utils_hasTrailingSlash, "utils_hasTrailingSlash");
    var ut2 = { rE: "2.6.1" };
    const dt2 = require$$9;
    var ft2 = __webpack_require__.n(dt2);
    const mt = /* @__PURE__ */ Object.create(null), dist_i = /* @__PURE__ */ __name((e3) => {
      var _a3, _b3;
      return ((_a3 = globalThis.process) == null ? void 0 : _a3.env) || ((_b3 = globalThis.Deno) == null ? void 0 : _b3.env.toObject()) || globalThis.__env__ || (e3 ? mt : globalThis);
    }, "dist_i"), gt2 = new Proxy(mt, { get: /* @__PURE__ */ __name((e3, t3) => dist_i()[t3] ?? mt[t3], "get"), has: /* @__PURE__ */ __name((e3, t3) => t3 in dist_i() || t3 in mt, "has"), set: /* @__PURE__ */ __name((e3, t3, i3) => (dist_i(true)[t3] = i3, true), "set"), deleteProperty(e3, t3) {
      if (!t3) return false;
      return delete dist_i(true)[t3], true;
    }, ownKeys() {
      const e3 = dist_i(true);
      return Object.keys(e3);
    } }), xt2 = typeof process < "u" && process.env && process.env.NODE_ENV || "", vt2 = [["APPVEYOR"], ["AWS_AMPLIFY", "AWS_APP_ID", { ci: true }], ["AZURE_PIPELINES", "SYSTEM_TEAMFOUNDATIONCOLLECTIONURI"], ["AZURE_STATIC", "INPUT_AZURE_STATIC_WEB_APPS_API_TOKEN"], ["APPCIRCLE", "AC_APPCIRCLE"], ["BAMBOO", "bamboo_planKey"], ["BITBUCKET", "BITBUCKET_COMMIT"], ["BITRISE", "BITRISE_IO"], ["BUDDY", "BUDDY_WORKSPACE_ID"], ["BUILDKITE"], ["CIRCLE", "CIRCLECI"], ["CIRRUS", "CIRRUS_CI"], ["CLOUDFLARE_PAGES", "CF_PAGES", { ci: true }], ["CLOUDFLARE_WORKERS", "WORKERS_CI", { ci: true }], ["CODEBUILD", "CODEBUILD_BUILD_ARN"], ["CODEFRESH", "CF_BUILD_ID"], ["DRONE"], ["DRONE", "DRONE_BUILD_EVENT"], ["DSARI"], ["GITHUB_ACTIONS"], ["GITLAB", "GITLAB_CI"], ["GITLAB", "CI_MERGE_REQUEST_ID"], ["GOCD", "GO_PIPELINE_LABEL"], ["LAYERCI"], ["HUDSON", "HUDSON_URL"], ["JENKINS", "JENKINS_URL"], ["MAGNUM"], ["NETLIFY"], ["NETLIFY", "NETLIFY_LOCAL", { ci: false }], ["NEVERCODE"], ["RENDER"], ["SAIL", "SAILCI"], ["SEMAPHORE"], ["SCREWDRIVER"], ["SHIPPABLE"], ["SOLANO", "TDDIUM"], ["STRIDER"], ["TEAMCITY", "TEAMCITY_VERSION"], ["TRAVIS"], ["VERCEL", "NOW_BUILDER"], ["VERCEL", "VERCEL", { ci: false }], ["VERCEL", "VERCEL_ENV", { ci: false }], ["APPCENTER", "APPCENTER_BUILD_ID"], ["CODESANDBOX", "CODESANDBOX_SSE", { ci: false }], ["CODESANDBOX", "CODESANDBOX_HOST", { ci: false }], ["STACKBLITZ"], ["STORMKIT"], ["CLEAVR"], ["ZEABUR"], ["CODESPHERE", "CODESPHERE_APP_ID", { ci: true }], ["RAILWAY", "RAILWAY_PROJECT_ID"], ["RAILWAY", "RAILWAY_SERVICE_ID"], ["DENO-DEPLOY", "DENO_DEPLOYMENT_ID"], ["FIREBASE_APP_HOSTING", "FIREBASE_APP_HOSTING", { ci: true }]];
    const yt2 = function() {
      var _a3, _b3, _c3, _d3, _e6, _f3;
      if ((_a3 = globalThis.process) == null ? void 0 : _a3.env) for (const e3 of vt2) {
        const t3 = e3[1] || e3[0];
        if ((_b3 = globalThis.process) == null ? void 0 : _b3.env[t3]) return { name: e3[0].toLowerCase(), ...e3[2] };
      }
      return "/bin/jsh" === ((_d3 = (_c3 = globalThis.process) == null ? void 0 : _c3.env) == null ? void 0 : _d3.SHELL) && ((_f3 = (_e6 = globalThis.process) == null ? void 0 : _e6.versions) == null ? void 0 : _f3.webcontainer) ? { name: "stackblitz", ci: false } : { name: "", ci: false };
    }();
    yt2.name;
    function std_env_dist_n(e3) {
      return !!e3 && "false" !== e3;
    }
    __name(std_env_dist_n, "std_env_dist_n");
    const _t3 = ((_a2 = globalThis.process) == null ? void 0 : _a2.platform) || "";
    std_env_dist_n(gt2.CI) || false !== yt2.ci;
    const bt2 = std_env_dist_n(((_b2 = globalThis.process) == null ? void 0 : _b2.stdout) && ((_c2 = globalThis.process) == null ? void 0 : _c2.stdout.isTTY));
    std_env_dist_n(gt2.DEBUG), "test" === xt2 || std_env_dist_n(gt2.TEST);
    const kt2 = (std_env_dist_n(gt2.MINIMAL), /^win/i.test(_t3)), wt = (!std_env_dist_n(gt2.NO_COLOR) && (std_env_dist_n(gt2.FORCE_COLOR) || (bt2 || kt2) && gt2.TERM), (((_e5 = (_d2 = globalThis.process) == null ? void 0 : _d2.versions) == null ? void 0 : _e5.node) || "").replace(/^v/, "") || null), It2 = (Number(wt == null ? void 0 : wt.split(".")[0]), globalThis.process || /* @__PURE__ */ Object.create(null)), Ct2 = { versions: {} }, Rt2 = (new Proxy(It2, { get: /* @__PURE__ */ __name((e3, t3) => "env" === t3 ? gt2 : t3 in e3 ? e3[t3] : t3 in Ct2 ? Ct2[t3] : void 0, "get") }), "node" === ((_g2 = (_f2 = globalThis.process) == null ? void 0 : _f2.release) == null ? void 0 : _g2.name)), Pt2 = !!globalThis.Bun || !!((_i2 = (_h2 = globalThis.process) == null ? void 0 : _h2.versions) == null ? void 0 : _i2.bun), Tt2 = !!globalThis.Deno, At2 = !!globalThis.fastly, Nt2 = [[!!globalThis.Netlify, "netlify"], [!!globalThis.EdgeRuntime, "edge-light"], ["Cloudflare-Workers" === ((_j2 = globalThis.navigator) == null ? void 0 : _j2.userAgent), "workerd"], [At2, "fastly"], [Tt2, "deno"], [Pt2, "bun"], [Rt2, "node"]];
    !function() {
      const e3 = Nt2.find((e4) => e4[0]);
      if (e3) e3[1];
    }();
    const Lt2 = require$$10, Ot2 = ((_m = (_l2 = (_k2 = Lt2 == null ? void 0 : Lt2.WriteStream) == null ? void 0 : _k2.prototype) == null ? void 0 : _l2.hasColors) == null ? void 0 : _m.call(_l2)) ?? false, base_format = /* @__PURE__ */ __name((e3, t3) => {
      if (!Ot2) return (e4) => e4;
      const i3 = `\x1B[${e3}m`, s2 = `\x1B[${t3}m`;
      return (e4) => {
        const r2 = e4 + "";
        let n3 = r2.indexOf(s2);
        if (-1 === n3) return i3 + r2 + s2;
        let a3 = i3, o2 = 0;
        const h3 = (22 === t3 ? s2 : "") + i3;
        for (; -1 !== n3; ) a3 += r2.slice(o2, n3) + h3, o2 = n3 + s2.length, n3 = r2.indexOf(s2, o2);
        return a3 += r2.slice(o2) + s2, a3;
      };
    }, "base_format"), Dt2 = base_format(31, 39), Vt2 = base_format(32, 39), Ut2 = base_format(33, 39), Mt = base_format(34, 39), jt = base_format(36, 39), Ft = base_format(90, 39);
    function isDir(e3) {
      if ("string" != typeof e3 || e3.startsWith("file://")) return false;
      try {
        return (0, ue2.lstatSync)(e3).isDirectory();
      } catch {
        return false;
      }
    }
    __name(isDir, "isDir");
    function utils_hash(e3, t3 = 8) {
      return (function() {
        var _a3, _b3;
        if (void 0 !== $t2) return $t2;
        try {
          return $t2 = !!((_b3 = (_a3 = ft2()).getFips) == null ? void 0 : _b3.call(_a3)), $t2;
        } catch {
          return $t2 = false, $t2;
        }
      }() ? ft2().createHash("sha256") : ft2().createHash("md5")).update(e3).digest("hex").slice(0, t3);
    }
    __name(utils_hash, "utils_hash");
    const Bt = { true: Vt2("true"), false: Ut2("false"), "[rebuild]": Ut2("[rebuild]"), "[esm]": Mt("[esm]"), "[cjs]": Vt2("[cjs]"), "[import]": Mt("[import]"), "[require]": Vt2("[require]"), "[native]": jt("[native]"), "[transpile]": Ut2("[transpile]"), "[fallback]": Dt2("[fallback]"), "[unknown]": Dt2("[unknown]"), "[hit]": Vt2("[hit]"), "[miss]": Ut2("[miss]"), "[json]": Vt2("[json]"), "[data]": Vt2("[data]") };
    function debug(e3, ...t3) {
      if (!e3.opts.debug) return;
      const i3 = process.cwd();
      console.log(Ft(["[jiti]", ...t3.map((e4) => e4 in Bt ? Bt[e4] : "string" != typeof e4 ? JSON.stringify(e4) : e4.replace(i3, "."))].join(" ")));
    }
    __name(debug, "debug");
    function jitiInteropDefault(e3, t3) {
      return e3.opts.interopDefault ? function(e4) {
        const t4 = typeof e4;
        if (null === e4 || "object" !== t4 && "function" !== t4) return e4;
        const i3 = e4.default, s2 = typeof i3, r2 = null == i3, n3 = "object" === s2 || "function" === s2;
        if (r2 && e4 instanceof Promise) return e4;
        return new Proxy(e4, { get(t5, s3, a3) {
          if ("__esModule" === s3) return true;
          if ("default" === s3) return r2 ? e4 : "function" == typeof (i3 == null ? void 0 : i3.default) && e4.__esModule ? i3.default : i3;
          if (Reflect.has(t5, s3)) return Reflect.get(t5, s3, a3);
          if (n3 && !(i3 instanceof Promise)) {
            let e5 = Reflect.get(i3, s3, a3);
            return "function" == typeof e5 && (e5 = e5.bind(i3)), e5;
          }
        }, apply: /* @__PURE__ */ __name((e5, t5, r3) => "function" == typeof e5 ? Reflect.apply(e5, t5, r3) : "function" === s2 ? Reflect.apply(i3, t5, r3) : void 0, "apply") });
      }(t3) : t3;
    }
    __name(jitiInteropDefault, "jitiInteropDefault");
    let $t2;
    function _booleanEnv(e3, t3) {
      const i3 = _jsonEnv(e3, t3);
      return Boolean(i3);
    }
    __name(_booleanEnv, "_booleanEnv");
    function _jsonEnv(e3, t3) {
      const i3 = process.env[e3];
      if (!(e3 in process.env)) return t3;
      try {
        return JSON.parse(i3);
      } catch {
        return t3;
      }
    }
    __name(_jsonEnv, "_jsonEnv");
    const qt2 = /\.(c|m)?j(sx?)$/, Wt = /\.(c|m)?t(sx?)$/;
    function jitiResolve(e3, t3, i3) {
      var _a3;
      let s2, r2;
      if (e3.isNativeRe.test(t3)) return t3;
      e3.alias && (t3 = function(e4, t4) {
        const i4 = pathe_M_eThtNZ_normalizeWindowsPath(e4);
        t4 = normalizeAliases(t4);
        for (const [e5, s3] of Object.entries(t4)) {
          if (!i4.startsWith(e5)) continue;
          const t5 = utils_hasTrailingSlash(e5) ? e5.slice(0, -1) : e5;
          if (utils_hasTrailingSlash(i4[t5.length])) return pathe_M_eThtNZ_join(s3, i4.slice(e5.length));
        }
        return i4;
      }(t3, e3.alias));
      let n3 = (i3 == null ? void 0 : i3.parentURL) || e3.url;
      isDir(n3) && (n3 = pathe_M_eThtNZ_join(n3, "_index.js"));
      const a3 = ((i3 == null ? void 0 : i3.async) ? [i3 == null ? void 0 : i3.conditions, ["node", "import"], ["node", "require"]] : [i3 == null ? void 0 : i3.conditions, ["node", "require"], ["node", "import"]]).filter(Boolean);
      for (const i4 of a3) {
        try {
          s2 = resolvePathSync(t3, { url: n3, conditions: i4, extensions: e3.opts.extensions });
        } catch (e4) {
          r2 = e4;
        }
        if (s2) return s2;
      }
      try {
        return e3.nativeRequire.resolve(t3, { paths: i3.paths });
      } catch (e4) {
        r2 = e4;
      }
      for (const r3 of e3.additionalExts) {
        if (s2 = tryNativeRequireResolve(e3, t3 + r3, n3, i3) || tryNativeRequireResolve(e3, t3 + "/index" + r3, n3, i3), s2) return s2;
        if ((Wt.test(e3.filename) || Wt.test(((_a3 = e3.parentModule) == null ? void 0 : _a3.filename) || "") || qt2.test(t3)) && (s2 = tryNativeRequireResolve(e3, t3.replace(qt2, ".$1t$2"), n3, i3), s2)) return s2;
      }
      if (!(i3 == null ? void 0 : i3.try)) throw r2;
    }
    __name(jitiResolve, "jitiResolve");
    function tryNativeRequireResolve(e3, t3, i3, s2) {
      try {
        return e3.nativeRequire.resolve(t3, { ...s2, paths: [pathe_M_eThtNZ_dirname(fileURLToPath(i3)), ...(s2 == null ? void 0 : s2.paths) || []] });
      } catch {
      }
    }
    __name(tryNativeRequireResolve, "tryNativeRequireResolve");
    const Gt2 = require$$11, Ht2 = require$$12;
    var Kt2 = __webpack_require__.n(Ht2);
    function jitiRequire(e3, t3, i3) {
      var _a3;
      const s2 = e3.parentCache || {};
      if (t3.startsWith("node:")) return nativeImportOrRequire(e3, t3, i3.async);
      if (t3.startsWith("file:")) t3 = (0, _e4.fileURLToPath)(t3);
      else if (t3.startsWith("data:")) {
        if (!i3.async) throw new Error("`data:` URLs are only supported in ESM context. Use `import` or `jiti.import` instead.");
        return debug(e3, "[native]", "[data]", "[import]", t3), nativeImportOrRequire(e3, t3, true);
      }
      if (le.builtinModules.includes(t3) || ".pnp.js" === t3) return nativeImportOrRequire(e3, t3, i3.async);
      if (e3.opts.tryNative && !e3.opts.transformOptions) try {
        if (!(t3 = jitiResolve(e3, t3, i3)) && i3.try) return;
        if (debug(e3, "[try-native]", i3.async && e3.nativeImport ? "[import]" : "[require]", t3), i3.async && e3.nativeImport) return e3.nativeImport(t3).then((i4) => (false === e3.opts.moduleCache && delete e3.nativeRequire.cache[t3], jitiInteropDefault(e3, i4)));
        {
          const i4 = e3.nativeRequire(t3);
          return false === e3.opts.moduleCache && delete e3.nativeRequire.cache[t3], jitiInteropDefault(e3, i4);
        }
      } catch (i4) {
        debug(e3, `[try-native] Using fallback for ${t3} because of an error:`, i4);
      }
      const r2 = jitiResolve(e3, t3, i3);
      if (!r2 && i3.try) return;
      const n3 = extname(r2);
      if (".json" === n3) {
        debug(e3, "[json]", r2);
        const t4 = e3.nativeRequire(r2);
        return t4 && !("default" in t4) && Object.defineProperty(t4, "default", { value: t4, enumerable: false }), t4;
      }
      if (n3 && !e3.opts.extensions.includes(n3)) return debug(e3, "[native]", "[unknown]", i3.async ? "[import]" : "[require]", r2), nativeImportOrRequire(e3, r2, i3.async);
      if (e3.isNativeRe.test(r2)) return debug(e3, "[native]", i3.async ? "[import]" : "[require]", r2), nativeImportOrRequire(e3, r2, i3.async);
      if (s2[r2]) return jitiInteropDefault(e3, (_a3 = s2[r2]) == null ? void 0 : _a3.exports);
      if (e3.opts.moduleCache) {
        const t4 = e3.nativeRequire.cache[r2];
        if (t4 == null ? void 0 : t4.loaded) return jitiInteropDefault(e3, t4.exports);
      }
      const a3 = (0, ue2.readFileSync)(r2, "utf8");
      return eval_evalModule(e3, a3, { id: t3, filename: r2, ext: n3, cache: s2, async: i3.async });
    }
    __name(jitiRequire, "jitiRequire");
    function nativeImportOrRequire(e3, t3, i3) {
      return i3 && e3.nativeImport ? e3.nativeImport(function(e4) {
        return kt2 && isAbsolute(e4) ? pathToFileURL2(e4) : e4;
      }(t3)).then((t4) => jitiInteropDefault(e3, t4)) : jitiInteropDefault(e3, e3.nativeRequire(t3));
    }
    __name(nativeImportOrRequire, "nativeImportOrRequire");
    const zt2 = "9";
    function getCache(e3, t3, i3) {
      if (!e3.opts.fsCache || !t3.filename) return i3();
      const s2 = ` /* v${zt2}-${utils_hash(t3.source, 16)} */
`;
      let r2 = `${basename(pathe_M_eThtNZ_dirname(t3.filename))}-${function(e4) {
        const t4 = e4.split(lt).pop();
        if (!t4) return;
        const i4 = t4.lastIndexOf(".");
        return i4 <= 0 ? t4 : t4.slice(0, i4);
      }(t3.filename)}` + (e3.opts.sourceMaps ? "+map" : "") + (t3.interopDefault ? ".i" : "") + `.${utils_hash(t3.filename)}` + (t3.async ? ".mjs" : ".cjs");
      t3.jsx && t3.filename.endsWith("x") && (r2 += "x");
      const n3 = e3.opts.fsCache, a3 = pathe_M_eThtNZ_join(n3, r2);
      if (!e3.opts.rebuildFsCache && (0, ue2.existsSync)(a3)) {
        const i4 = (0, ue2.readFileSync)(a3, "utf8");
        if (i4.endsWith(s2)) return debug(e3, "[cache]", "[hit]", t3.filename, "~>", a3), i4;
      }
      debug(e3, "[cache]", "[miss]", t3.filename);
      const o2 = i3();
      return o2.includes("__JITI_ERROR__") || ((0, ue2.writeFileSync)(a3, o2 + s2, "utf8"), debug(e3, "[cache]", "[store]", t3.filename, "~>", a3)), o2;
    }
    __name(getCache, "getCache");
    function prepareCacheDir(t3) {
      if (true === t3.opts.fsCache && (t3.opts.fsCache = function(t4) {
        const i3 = t4.filename && pathe_M_eThtNZ_resolve(t4.filename, "../node_modules");
        if (i3 && (0, ue2.existsSync)(i3)) return pathe_M_eThtNZ_join(i3, ".cache/jiti");
        let s2 = (0, e2.tmpdir)();
        if (process.env.TMPDIR && s2 === process.cwd() && !process.env.JITI_RESPECT_TMPDIR_ENV) {
          const t5 = process.env.TMPDIR;
          delete process.env.TMPDIR, s2 = (0, e2.tmpdir)(), process.env.TMPDIR = t5;
        }
        return pathe_M_eThtNZ_join(s2, "jiti");
      }(t3)), t3.opts.fsCache) try {
        if ((0, ue2.mkdirSync)(t3.opts.fsCache, { recursive: true }), !function(e3) {
          try {
            return (0, ue2.accessSync)(e3, ue2.constants.W_OK), true;
          } catch {
            return false;
          }
        }(t3.opts.fsCache)) throw new Error("directory is not writable!");
      } catch (e3) {
        debug(t3, "Error creating cache directory at ", t3.opts.fsCache, e3), t3.opts.fsCache = false;
      }
    }
    __name(prepareCacheDir, "prepareCacheDir");
    function transform2(e3, t3) {
      let i3 = getCache(e3, t3, () => {
        var _a3;
        const i4 = e3.opts.transform({ ...e3.opts.transformOptions, babel: { ...e3.opts.sourceMaps ? { sourceFileName: t3.filename, sourceMaps: "inline" } : {}, ...(_a3 = e3.opts.transformOptions) == null ? void 0 : _a3.babel }, interopDefault: e3.opts.interopDefault, ...t3 });
        return i4.error && e3.opts.debug && debug(e3, i4.error), i4.code;
      });
      return i3.startsWith("#!") && (i3 = "// " + i3), i3;
    }
    __name(transform2, "transform");
    function eval_evalModule(e3, t3, i3 = {}) {
      var _a3;
      const s2 = i3.id || (i3.filename ? basename(i3.filename) : `_jitiEval.${i3.ext || (i3.async ? "mjs" : "js")}`), r2 = i3.filename || jitiResolve(e3, s2, { async: i3.async }), n3 = i3.ext || extname(r2), a3 = i3.cache || e3.parentCache || {}, o2 = /\.[cm]?tsx?$/.test(n3), h3 = ".mjs" === n3 || ".js" === n3 && "module" === ((_a3 = function(e4) {
        for (; e4 && "." !== e4 && "/" !== e4; ) {
          e4 = pathe_M_eThtNZ_join(e4, "..");
          try {
            const t4 = (0, ue2.readFileSync)(pathe_M_eThtNZ_join(e4, "package.json"), "utf8");
            try {
              return JSON.parse(t4);
            } catch {
            }
            break;
          } catch {
          }
        }
      }(r2)) == null ? void 0 : _a3.type), c3 = ".cjs" === n3, p2 = i3.forceTranspile ?? (!c3 && !(h3 && i3.async) && (o2 || h3 || e3.isTransformRe.test(r2) || hasESMSyntax(t3))), l3 = Gt2.performance.now();
      if (p2) {
        t3 = transform2(e3, { filename: r2, source: t3, ts: o2, async: i3.async ?? false, jsx: e3.opts.jsx });
        const s3 = Math.round(1e3 * (Gt2.performance.now() - l3)) / 1e3;
        debug(e3, "[transpile]", i3.async ? "[esm]" : "[cjs]", r2, `(${s3}ms)`);
      } else {
        if (debug(e3, "[native]", i3.async ? "[import]" : "[require]", r2), i3.async) return Promise.resolve(nativeImportOrRequire(e3, r2, i3.async)).catch((s3) => (debug(e3, "Native import error:", s3), debug(e3, "[fallback]", r2), eval_evalModule(e3, t3, { ...i3, forceTranspile: true })));
        try {
          return nativeImportOrRequire(e3, r2, i3.async);
        } catch (s3) {
          debug(e3, "Native require error:", s3), debug(e3, "[fallback]", r2), t3 = transform2(e3, { filename: r2, source: t3, ts: o2, async: i3.async ?? false, jsx: e3.opts.jsx });
        }
      }
      const u3 = new le.Module(r2);
      u3.filename = r2, e3.parentModule && (u3.parent = e3.parentModule, Array.isArray(e3.parentModule.children) && !e3.parentModule.children.includes(u3) && e3.parentModule.children.push(u3));
      const d3 = createJiti2(r2, e3.opts, { parentModule: u3, parentCache: a3, nativeImport: e3.nativeImport, onError: e3.onError, createRequire: e3.createRequire }, true);
      let f3;
      u3.require = d3, u3.path = pathe_M_eThtNZ_dirname(r2), u3.paths = le.Module._nodeModulePaths(u3.path), a3[r2] = u3, e3.opts.moduleCache && (e3.nativeRequire.cache[r2] = u3);
      const m2 = function(e4, t4) {
        return `(${(t4 == null ? void 0 : t4.async) ? "async " : ""}function (exports, require, module, __filename, __dirname, jitiImport, jitiESMResolve) { ${e4}
});`;
      }(t3, { async: i3.async });
      try {
        f3 = Kt2().runInThisContext(m2, { filename: r2, lineOffset: 0, displayErrors: false });
      } catch (t4) {
        "SyntaxError" === t4.name && i3.async && e3.nativeImport ? (debug(e3, "[esm]", "[import]", "[fallback]", r2), f3 = function(e4, t5) {
          const i4 = `data:text/javascript;base64,${Buffer.from(`export default ${e4}`).toString("base64")}`;
          return (...e5) => t5(i4).then((t6) => t6.default(...e5));
        }(m2, e3.nativeImport)) : (e3.opts.moduleCache && delete e3.nativeRequire.cache[r2], e3.onError(t4));
      }
      let g3;
      try {
        g3 = f3(u3.exports, u3.require, u3, u3.filename, pathe_M_eThtNZ_dirname(u3.filename), d3.import, d3.esmResolve);
      } catch (t4) {
        e3.opts.moduleCache && delete e3.nativeRequire.cache[r2], e3.onError(t4);
      }
      function next() {
        if (u3.exports && u3.exports.__JITI_ERROR__) {
          const { filename: t4, line: i4, column: s3, code: r3, message: n4 } = u3.exports.__JITI_ERROR__, a4 = new Error(`${r3}: ${n4} 
 ${`${t4}:${i4}:${s3}`}`);
          Error.captureStackTrace(a4, jitiRequire), e3.onError(a4);
        }
        u3.loaded = true;
        return jitiInteropDefault(e3, u3.exports);
      }
      __name(next, "next");
      return i3.async ? Promise.resolve(g3).then(next) : next();
    }
    __name(eval_evalModule, "eval_evalModule");
    const Jt2 = "win32" === (0, e2.platform)();
    function createJiti2(e3, t3 = {}, i3, s2 = false) {
      const r2 = s2 ? t3 : function(e4) {
        const t4 = { fsCache: _booleanEnv("JITI_FS_CACHE", _booleanEnv("JITI_CACHE", true)), rebuildFsCache: _booleanEnv("JITI_REBUILD_FS_CACHE", false), moduleCache: _booleanEnv("JITI_MODULE_CACHE", _booleanEnv("JITI_REQUIRE_CACHE", true)), debug: _booleanEnv("JITI_DEBUG", false), sourceMaps: _booleanEnv("JITI_SOURCE_MAPS", false), interopDefault: _booleanEnv("JITI_INTEROP_DEFAULT", true), extensions: _jsonEnv("JITI_EXTENSIONS", [".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx"]), alias: _jsonEnv("JITI_ALIAS", {}), nativeModules: _jsonEnv("JITI_NATIVE_MODULES", []), transformModules: _jsonEnv("JITI_TRANSFORM_MODULES", []), tryNative: _jsonEnv("JITI_TRY_NATIVE", "Bun" in globalThis), jsx: _booleanEnv("JITI_JSX", false) };
        t4.jsx && t4.extensions.push(".jsx", ".tsx");
        const i4 = {};
        return void 0 !== e4.cache && (i4.fsCache = e4.cache), void 0 !== e4.requireCache && (i4.moduleCache = e4.requireCache), { ...t4, ...i4, ...e4 };
      }(t3), n3 = r2.alias && Object.keys(r2.alias).length > 0 ? normalizeAliases(r2.alias || {}) : void 0, a3 = ["typescript", "jiti", ...r2.nativeModules || []], o2 = new RegExp(`node_modules/(${a3.map((e4) => escapeStringRegexp(e4)).join("|")})/`), h3 = [...r2.transformModules || []], c3 = new RegExp(`node_modules/(${h3.map((e4) => escapeStringRegexp(e4)).join("|")})/`);
      e3 || (e3 = process.cwd()), !s2 && isDir(e3) && (e3 = pathe_M_eThtNZ_join(e3, "_index.js"));
      const p2 = pathToFileURL2(e3), l3 = [...r2.extensions].filter((e4) => ".js" !== e4), u3 = i3.createRequire(Jt2 ? e3.replace(/\//g, "\\") : e3), d3 = { filename: e3, url: p2, opts: r2, alias: n3, nativeModules: a3, transformModules: h3, isNativeRe: o2, isTransformRe: c3, additionalExts: l3, nativeRequire: u3, onError: i3.onError, parentModule: i3.parentModule, parentCache: i3.parentCache, nativeImport: i3.nativeImport, createRequire: i3.createRequire };
      s2 || debug(d3, "[init]", ...[["version:", ut2.rE], ["module-cache:", r2.moduleCache], ["fs-cache:", r2.fsCache], ["rebuild-fs-cache:", r2.rebuildFsCache], ["interop-defaults:", r2.interopDefault]].flat()), s2 || prepareCacheDir(d3);
      const f3 = Object.assign(function(e4) {
        return jitiRequire(d3, e4, { async: false });
      }, { cache: r2.moduleCache ? u3.cache : /* @__PURE__ */ Object.create(null), extensions: u3.extensions, main: u3.main, options: r2, resolve: Object.assign(function(e4) {
        return jitiResolve(d3, e4, { async: false });
      }, { paths: u3.resolve.paths }), transform: /* @__PURE__ */ __name((e4) => transform2(d3, e4), "transform"), evalModule: /* @__PURE__ */ __name((e4, t4) => eval_evalModule(d3, e4, t4), "evalModule"), async import(e4, t4) {
        const i4 = await jitiRequire(d3, e4, { ...t4, async: true });
        return (t4 == null ? void 0 : t4.default) ? (i4 == null ? void 0 : i4.default) ?? i4 : i4;
      }, esmResolve(e4, t4) {
        "string" == typeof t4 && (t4 = { parentURL: t4 });
        const i4 = jitiResolve(d3, e4, { parentURL: p2, ...t4, async: true });
        return !i4 || "string" != typeof i4 || i4.startsWith("file://") ? i4 : pathToFileURL2(i4);
      } });
      return f3;
    }
    __name(createJiti2, "createJiti");
  })(), jiti.exports = i2.default;
})();
var jitiExports = jiti.exports;
const _createJiti = /* @__PURE__ */ getDefaultExportFromCjs(jitiExports);
function onError(err) {
  throw err;
}
__name(onError, "onError");
const nativeImport = /* @__PURE__ */ __name((id) => import(id), "nativeImport");
let _transform;
function lazyTransform(...args) {
  if (!_transform) {
    _transform = createRequire(import.meta.url)("../dist/babel.cjs");
  }
  return _transform(...args);
}
__name(lazyTransform, "lazyTransform");
function createJiti(id, opts = {}) {
  if (!opts.transform) {
    opts = { ...opts, transform: lazyTransform };
  }
  return _createJiti(id, opts, {
    onError,
    nativeImport,
    createRequire
  });
}
__name(createJiti, "createJiti");
var comma = ",".charCodeAt(0);
var semicolon = ";".charCodeAt(0);
var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var intToChar = new Uint8Array(64);
var charToInt = new Uint8Array(128);
for (let i2 = 0; i2 < chars.length; i2++) {
  const c2 = chars.charCodeAt(i2);
  intToChar[i2] = c2;
  charToInt[c2] = i2;
}
function decodeInteger(reader, relative) {
  let value = 0;
  let shift = 0;
  let integer = 0;
  do {
    const c2 = reader.next();
    integer = charToInt[c2];
    value |= (integer & 31) << shift;
    shift += 5;
  } while (integer & 32);
  const shouldNegate = value & 1;
  value >>>= 1;
  if (shouldNegate) {
    value = -2147483648 | -value;
  }
  return relative + value;
}
__name(decodeInteger, "decodeInteger");
function encodeInteger(builder, num, relative) {
  let delta = num - relative;
  delta = delta < 0 ? -delta << 1 | 1 : delta << 1;
  do {
    let clamped = delta & 31;
    delta >>>= 5;
    if (delta > 0) clamped |= 32;
    builder.write(intToChar[clamped]);
  } while (delta > 0);
  return num;
}
__name(encodeInteger, "encodeInteger");
function hasMoreVlq(reader, max) {
  if (reader.pos >= max) return false;
  return reader.peek() !== comma;
}
__name(hasMoreVlq, "hasMoreVlq");
var bufLength = 1024 * 16;
var td = typeof TextDecoder !== "undefined" ? /* @__PURE__ */ new TextDecoder() : typeof Buffer !== "undefined" ? {
  decode(buf) {
    const out = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    return out.toString();
  }
} : {
  decode(buf) {
    let out = "";
    for (let i2 = 0; i2 < buf.length; i2++) {
      out += String.fromCharCode(buf[i2]);
    }
    return out;
  }
};
var StringWriter = (_a = class {
  constructor() {
    this.pos = 0;
    this.out = "";
    this.buffer = new Uint8Array(bufLength);
  }
  write(v2) {
    const { buffer } = this;
    buffer[this.pos++] = v2;
    if (this.pos === bufLength) {
      this.out += td.decode(buffer);
      this.pos = 0;
    }
  }
  flush() {
    const { buffer, out, pos } = this;
    return pos > 0 ? out + td.decode(buffer.subarray(0, pos)) : out;
  }
}, __name(_a, "StringWriter"), _a);
var StringReader = (_b = class {
  constructor(buffer) {
    this.pos = 0;
    this.buffer = buffer;
  }
  next() {
    return this.buffer.charCodeAt(this.pos++);
  }
  peek() {
    return this.buffer.charCodeAt(this.pos);
  }
  indexOf(char) {
    const { buffer, pos } = this;
    const idx = buffer.indexOf(char, pos);
    return idx === -1 ? buffer.length : idx;
  }
}, __name(_b, "StringReader"), _b);
function decode(mappings) {
  const { length } = mappings;
  const reader = new StringReader(mappings);
  const decoded = [];
  let genColumn = 0;
  let sourcesIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let namesIndex = 0;
  do {
    const semi = reader.indexOf(";");
    const line = [];
    let sorted = true;
    let lastCol = 0;
    genColumn = 0;
    while (reader.pos < semi) {
      let seg;
      genColumn = decodeInteger(reader, genColumn);
      if (genColumn < lastCol) sorted = false;
      lastCol = genColumn;
      if (hasMoreVlq(reader, semi)) {
        sourcesIndex = decodeInteger(reader, sourcesIndex);
        sourceLine = decodeInteger(reader, sourceLine);
        sourceColumn = decodeInteger(reader, sourceColumn);
        if (hasMoreVlq(reader, semi)) {
          namesIndex = decodeInteger(reader, namesIndex);
          seg = [genColumn, sourcesIndex, sourceLine, sourceColumn, namesIndex];
        } else {
          seg = [genColumn, sourcesIndex, sourceLine, sourceColumn];
        }
      } else {
        seg = [genColumn];
      }
      line.push(seg);
      reader.pos++;
    }
    if (!sorted) sort(line);
    decoded.push(line);
    reader.pos = semi + 1;
  } while (reader.pos <= length);
  return decoded;
}
__name(decode, "decode");
function sort(line) {
  line.sort(sortComparator$1);
}
__name(sort, "sort");
function sortComparator$1(a2, b) {
  return a2[0] - b[0];
}
__name(sortComparator$1, "sortComparator$1");
function encode(decoded) {
  const writer = new StringWriter();
  let sourcesIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let namesIndex = 0;
  for (let i2 = 0; i2 < decoded.length; i2++) {
    const line = decoded[i2];
    if (i2 > 0) writer.write(semicolon);
    if (line.length === 0) continue;
    let genColumn = 0;
    for (let j = 0; j < line.length; j++) {
      const segment = line[j];
      if (j > 0) writer.write(comma);
      genColumn = encodeInteger(writer, segment[0], genColumn);
      if (segment.length === 1) continue;
      sourcesIndex = encodeInteger(writer, segment[1], sourcesIndex);
      sourceLine = encodeInteger(writer, segment[2], sourceLine);
      sourceColumn = encodeInteger(writer, segment[3], sourceColumn);
      if (segment.length === 4) continue;
      namesIndex = encodeInteger(writer, segment[4], namesIndex);
    }
  }
  return writer.flush();
}
__name(encode, "encode");
const schemeRegex = /^[\w+.-]+:\/\//;
const urlRegex = /^([\w+.-]+:)\/\/([^@/#?]*@)?([^:/#?]*)(:\d+)?(\/[^#?]*)?(\?[^#]*)?(#.*)?/;
const fileRegex = /^file:(?:\/\/((?![a-z]:)[^/#?]*)?)?(\/?[^#?]*)(\?[^#]*)?(#.*)?/i;
function isAbsoluteUrl(input) {
  return schemeRegex.test(input);
}
__name(isAbsoluteUrl, "isAbsoluteUrl");
function isSchemeRelativeUrl(input) {
  return input.startsWith("//");
}
__name(isSchemeRelativeUrl, "isSchemeRelativeUrl");
function isAbsolutePath(input) {
  return input.startsWith("/");
}
__name(isAbsolutePath, "isAbsolutePath");
function isFileUrl(input) {
  return input.startsWith("file:");
}
__name(isFileUrl, "isFileUrl");
function isRelative(input) {
  return /^[.?#]/.test(input);
}
__name(isRelative, "isRelative");
function parseAbsoluteUrl(input) {
  const match = urlRegex.exec(input);
  return makeUrl(match[1], match[2] || "", match[3], match[4] || "", match[5] || "/", match[6] || "", match[7] || "");
}
__name(parseAbsoluteUrl, "parseAbsoluteUrl");
function parseFileUrl(input) {
  const match = fileRegex.exec(input);
  const path2 = match[2];
  return makeUrl("file:", "", match[1] || "", "", isAbsolutePath(path2) ? path2 : "/" + path2, match[3] || "", match[4] || "");
}
__name(parseFileUrl, "parseFileUrl");
function makeUrl(scheme, user, host, port, path2, query, hash) {
  return {
    scheme,
    user,
    host,
    port,
    path: path2,
    query,
    hash,
    type: 7
  };
}
__name(makeUrl, "makeUrl");
function parseUrl(input) {
  if (isSchemeRelativeUrl(input)) {
    const url2 = parseAbsoluteUrl("http:" + input);
    url2.scheme = "";
    url2.type = 6;
    return url2;
  }
  if (isAbsolutePath(input)) {
    const url2 = parseAbsoluteUrl("http://foo.com" + input);
    url2.scheme = "";
    url2.host = "";
    url2.type = 5;
    return url2;
  }
  if (isFileUrl(input))
    return parseFileUrl(input);
  if (isAbsoluteUrl(input))
    return parseAbsoluteUrl(input);
  const url = parseAbsoluteUrl("http://foo.com/" + input);
  url.scheme = "";
  url.host = "";
  url.type = input ? input.startsWith("?") ? 3 : input.startsWith("#") ? 2 : 4 : 1;
  return url;
}
__name(parseUrl, "parseUrl");
function stripPathFilename(path2) {
  if (path2.endsWith("/.."))
    return path2;
  const index = path2.lastIndexOf("/");
  return path2.slice(0, index + 1);
}
__name(stripPathFilename, "stripPathFilename");
function mergePaths(url, base) {
  normalizePath(base, base.type);
  if (url.path === "/") {
    url.path = base.path;
  } else {
    url.path = stripPathFilename(base.path) + url.path;
  }
}
__name(mergePaths, "mergePaths");
function normalizePath(url, type) {
  const rel = type <= 4;
  const pieces = url.path.split("/");
  let pointer = 1;
  let positive = 0;
  let addTrailingSlash = false;
  for (let i2 = 1; i2 < pieces.length; i2++) {
    const piece = pieces[i2];
    if (!piece) {
      addTrailingSlash = true;
      continue;
    }
    addTrailingSlash = false;
    if (piece === ".")
      continue;
    if (piece === "..") {
      if (positive) {
        addTrailingSlash = true;
        positive--;
        pointer--;
      } else if (rel) {
        pieces[pointer++] = piece;
      }
      continue;
    }
    pieces[pointer++] = piece;
    positive++;
  }
  let path2 = "";
  for (let i2 = 1; i2 < pointer; i2++) {
    path2 += "/" + pieces[i2];
  }
  if (!path2 || addTrailingSlash && !path2.endsWith("/..")) {
    path2 += "/";
  }
  url.path = path2;
}
__name(normalizePath, "normalizePath");
function resolve(input, base) {
  if (!input && !base)
    return "";
  const url = parseUrl(input);
  let inputType = url.type;
  if (base && inputType !== 7) {
    const baseUrl = parseUrl(base);
    const baseType = baseUrl.type;
    switch (inputType) {
      case 1:
        url.hash = baseUrl.hash;
      case 2:
        url.query = baseUrl.query;
      case 3:
      case 4:
        mergePaths(url, baseUrl);
      case 5:
        url.user = baseUrl.user;
        url.host = baseUrl.host;
        url.port = baseUrl.port;
      case 6:
        url.scheme = baseUrl.scheme;
    }
    if (baseType > inputType)
      inputType = baseType;
  }
  normalizePath(url, inputType);
  const queryHash = url.query + url.hash;
  switch (inputType) {
    case 2:
    case 3:
      return queryHash;
    case 4: {
      const path2 = url.path.slice(1);
      if (!path2)
        return queryHash || ".";
      if (isRelative(base || input) && !isRelative(path2)) {
        return "./" + path2 + queryHash;
      }
      return path2 + queryHash;
    }
    case 5:
      return url.path + queryHash;
    default:
      return url.scheme + "//" + url.user + url.host + url.port + url.path + queryHash;
  }
}
__name(resolve, "resolve");
function stripFilename(path2) {
  if (!path2) return "";
  const index = path2.lastIndexOf("/");
  return path2.slice(0, index + 1);
}
__name(stripFilename, "stripFilename");
function resolver(mapUrl, sourceRoot) {
  const from = stripFilename(mapUrl);
  const prefix = sourceRoot ? sourceRoot + "/" : "";
  return (source) => resolve(prefix + (source || ""), from);
}
__name(resolver, "resolver");
var COLUMN$1 = 0;
function maybeSort(mappings, owned) {
  const unsortedIndex = nextUnsortedSegmentLine(mappings, 0);
  if (unsortedIndex === mappings.length) return mappings;
  if (!owned) mappings = mappings.slice();
  for (let i2 = unsortedIndex; i2 < mappings.length; i2 = nextUnsortedSegmentLine(mappings, i2 + 1)) {
    mappings[i2] = sortSegments(mappings[i2], owned);
  }
  return mappings;
}
__name(maybeSort, "maybeSort");
function nextUnsortedSegmentLine(mappings, start) {
  for (let i2 = start; i2 < mappings.length; i2++) {
    if (!isSorted(mappings[i2])) return i2;
  }
  return mappings.length;
}
__name(nextUnsortedSegmentLine, "nextUnsortedSegmentLine");
function isSorted(line) {
  for (let j = 1; j < line.length; j++) {
    if (line[j][COLUMN$1] < line[j - 1][COLUMN$1]) {
      return false;
    }
  }
  return true;
}
__name(isSorted, "isSorted");
function sortSegments(line, owned) {
  if (!owned) line = line.slice();
  return line.sort(sortComparator);
}
__name(sortSegments, "sortSegments");
function sortComparator(a2, b) {
  return a2[COLUMN$1] - b[COLUMN$1];
}
__name(sortComparator, "sortComparator");
var found = false;
function binarySearch(haystack, needle, low, high) {
  while (low <= high) {
    const mid = low + (high - low >> 1);
    const cmp = haystack[mid][COLUMN$1] - needle;
    if (cmp === 0) {
      found = true;
      return mid;
    }
    if (cmp < 0) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  found = false;
  return low - 1;
}
__name(binarySearch, "binarySearch");
function lowerBound(haystack, needle, index) {
  for (let i2 = index - 1; i2 >= 0; index = i2--) {
    if (haystack[i2][COLUMN$1] !== needle) break;
  }
  return index;
}
__name(lowerBound, "lowerBound");
function memoizedState() {
  return {
    lastKey: -1,
    lastNeedle: -1,
    lastIndex: -1
  };
}
__name(memoizedState, "memoizedState");
function memoizedBinarySearch(haystack, needle, state, key) {
  const { lastKey, lastNeedle, lastIndex } = state;
  let low = 0;
  let high = haystack.length - 1;
  if (key === lastKey) {
    if (needle === lastNeedle) {
      found = lastIndex !== -1 && haystack[lastIndex][COLUMN$1] === needle;
      return lastIndex;
    }
    if (needle >= lastNeedle) {
      low = lastIndex === -1 ? 0 : lastIndex;
    } else {
      high = lastIndex;
    }
  }
  state.lastKey = key;
  state.lastNeedle = needle;
  return state.lastIndex = binarySearch(haystack, needle, low, high);
}
__name(memoizedBinarySearch, "memoizedBinarySearch");
function parse(map) {
  return typeof map === "string" ? JSON.parse(map) : map;
}
__name(parse, "parse");
var TraceMap = (_c = class {
  constructor(map, mapUrl) {
    const isString = typeof map === "string";
    if (!isString && map._decodedMemo) return map;
    const parsed = parse(map);
    const { version: version2, file, names, sourceRoot, sources, sourcesContent } = parsed;
    this.version = version2;
    this.file = file;
    this.names = names || [];
    this.sourceRoot = sourceRoot;
    this.sources = sources;
    this.sourcesContent = sourcesContent;
    this.ignoreList = parsed.ignoreList || parsed.x_google_ignoreList || void 0;
    const resolve2 = resolver(mapUrl, sourceRoot);
    this.resolvedSources = sources.map(resolve2);
    const { mappings } = parsed;
    if (typeof mappings === "string") {
      this._encoded = mappings;
      this._decoded = void 0;
    } else if (Array.isArray(mappings)) {
      this._encoded = void 0;
      this._decoded = maybeSort(mappings, isString);
    } else if (parsed.sections) {
      throw new Error(`TraceMap passed sectioned source map, please use FlattenMap export instead`);
    } else {
      throw new Error(`invalid source map: ${JSON.stringify(parsed)}`);
    }
    this._decodedMemo = memoizedState();
    this._bySources = void 0;
    this._bySourceMemos = void 0;
  }
}, __name(_c, "TraceMap"), _c);
function cast$1(map) {
  return map;
}
__name(cast$1, "cast$1");
function decodedMappings(map) {
  var _a2;
  return (_a2 = cast$1(map))._decoded || (_a2._decoded = decode(cast$1(map)._encoded));
}
__name(decodedMappings, "decodedMappings");
function traceSegment(map, line, column) {
  const decoded = decodedMappings(map);
  if (line >= decoded.length) return null;
  const segments = decoded[line];
  const index = traceSegmentInternal(
    segments,
    cast$1(map)._decodedMemo,
    line,
    column
  );
  return index === -1 ? null : segments[index];
}
__name(traceSegment, "traceSegment");
function traceSegmentInternal(segments, memo, line, column, bias) {
  let index = memoizedBinarySearch(segments, column, memo, line);
  if (found) {
    index = lowerBound(segments, column, index);
  }
  if (index === -1 || index === segments.length) return -1;
  return index;
}
__name(traceSegmentInternal, "traceSegmentInternal");
var SetArray = (_d = class {
  constructor() {
    this._indexes = { __proto__: null };
    this.array = [];
  }
}, __name(_d, "SetArray"), _d);
function cast(set) {
  return set;
}
__name(cast, "cast");
function get(setarr, key) {
  return cast(setarr)._indexes[key];
}
__name(get, "get");
function put(setarr, key) {
  const index = get(setarr, key);
  if (index !== void 0) return index;
  const { array, _indexes: indexes } = cast(setarr);
  const length = array.push(key);
  return indexes[key] = length - 1;
}
__name(put, "put");
function remove(setarr, key) {
  const index = get(setarr, key);
  if (index === void 0) return;
  const { array, _indexes: indexes } = cast(setarr);
  for (let i2 = index + 1; i2 < array.length; i2++) {
    const k2 = array[i2];
    array[i2 - 1] = k2;
    indexes[k2]--;
  }
  indexes[key] = void 0;
  array.pop();
}
__name(remove, "remove");
var COLUMN = 0;
var SOURCES_INDEX = 1;
var SOURCE_LINE = 2;
var SOURCE_COLUMN = 3;
var NAMES_INDEX = 4;
var NO_NAME = -1;
var GenMapping = (_e2 = class {
  constructor({ file, sourceRoot } = {}) {
    this._names = new SetArray();
    this._sources = new SetArray();
    this._sourcesContent = [];
    this._mappings = [];
    this.file = file;
    this.sourceRoot = sourceRoot;
    this._ignoreList = new SetArray();
  }
}, __name(_e2, "GenMapping"), _e2);
function cast2(map) {
  return map;
}
__name(cast2, "cast2");
var maybeAddSegment = /* @__PURE__ */ __name((map, genLine, genColumn, source, sourceLine, sourceColumn, name2, content) => {
  return addSegmentInternal(
    true,
    map,
    genLine,
    genColumn,
    source,
    sourceLine,
    sourceColumn,
    name2
  );
}, "maybeAddSegment");
function setSourceContent(map, source, content) {
  const {
    _sources: sources,
    _sourcesContent: sourcesContent
    // _originalScopes: originalScopes,
  } = cast2(map);
  const index = put(sources, source);
  sourcesContent[index] = content;
}
__name(setSourceContent, "setSourceContent");
function setIgnore(map, source, ignore = true) {
  const {
    _sources: sources,
    _sourcesContent: sourcesContent,
    _ignoreList: ignoreList
    // _originalScopes: originalScopes,
  } = cast2(map);
  const index = put(sources, source);
  if (index === sourcesContent.length) sourcesContent[index] = null;
  if (ignore) put(ignoreList, index);
  else remove(ignoreList, index);
}
__name(setIgnore, "setIgnore");
function toDecodedMap(map) {
  const {
    _mappings: mappings,
    _sources: sources,
    _sourcesContent: sourcesContent,
    _names: names,
    _ignoreList: ignoreList
    // _originalScopes: originalScopes,
    // _generatedRanges: generatedRanges,
  } = cast2(map);
  removeEmptyFinalLines(mappings);
  return {
    version: 3,
    file: map.file || void 0,
    names: names.array,
    sourceRoot: map.sourceRoot || void 0,
    sources: sources.array,
    sourcesContent,
    mappings,
    // originalScopes,
    // generatedRanges,
    ignoreList: ignoreList.array
  };
}
__name(toDecodedMap, "toDecodedMap");
function toEncodedMap(map) {
  const decoded = toDecodedMap(map);
  return Object.assign({}, decoded, {
    // originalScopes: decoded.originalScopes.map((os) => encodeOriginalScopes(os)),
    // generatedRanges: encodeGeneratedRanges(decoded.generatedRanges as GeneratedRange[]),
    mappings: encode(decoded.mappings)
  });
}
__name(toEncodedMap, "toEncodedMap");
function addSegmentInternal(skipable, map, genLine, genColumn, source, sourceLine, sourceColumn, name2, content) {
  const {
    _mappings: mappings,
    _sources: sources,
    _sourcesContent: sourcesContent,
    _names: names
    // _originalScopes: originalScopes,
  } = cast2(map);
  const line = getIndex(mappings, genLine);
  const index = getColumnIndex(line, genColumn);
  if (!source) {
    if (skipSourceless(line, index)) return;
    return insert(line, index, [genColumn]);
  }
  const sourcesIndex = put(sources, source);
  const namesIndex = name2 ? put(names, name2) : NO_NAME;
  if (sourcesIndex === sourcesContent.length) sourcesContent[sourcesIndex] = null;
  if (skipSource(line, index, sourcesIndex, sourceLine, sourceColumn, namesIndex)) {
    return;
  }
  return insert(
    line,
    index,
    name2 ? [genColumn, sourcesIndex, sourceLine, sourceColumn, namesIndex] : [genColumn, sourcesIndex, sourceLine, sourceColumn]
  );
}
__name(addSegmentInternal, "addSegmentInternal");
function getIndex(arr, index) {
  for (let i2 = arr.length; i2 <= index; i2++) {
    arr[i2] = [];
  }
  return arr[index];
}
__name(getIndex, "getIndex");
function getColumnIndex(line, genColumn) {
  let index = line.length;
  for (let i2 = index - 1; i2 >= 0; index = i2--) {
    const current = line[i2];
    if (genColumn >= current[COLUMN]) break;
  }
  return index;
}
__name(getColumnIndex, "getColumnIndex");
function insert(array, index, value) {
  for (let i2 = array.length; i2 > index; i2--) {
    array[i2] = array[i2 - 1];
  }
  array[index] = value;
}
__name(insert, "insert");
function removeEmptyFinalLines(mappings) {
  const { length } = mappings;
  let len = length;
  for (let i2 = len - 1; i2 >= 0; len = i2, i2--) {
    if (mappings[i2].length > 0) break;
  }
  if (len < length) mappings.length = len;
}
__name(removeEmptyFinalLines, "removeEmptyFinalLines");
function skipSourceless(line, index) {
  if (index === 0) return true;
  const prev = line[index - 1];
  return prev.length === 1;
}
__name(skipSourceless, "skipSourceless");
function skipSource(line, index, sourcesIndex, sourceLine, sourceColumn, namesIndex) {
  if (index === 0) return false;
  const prev = line[index - 1];
  if (prev.length === 1) return false;
  return sourcesIndex === prev[SOURCES_INDEX] && sourceLine === prev[SOURCE_LINE] && sourceColumn === prev[SOURCE_COLUMN] && namesIndex === (prev.length === 5 ? prev[NAMES_INDEX] : NO_NAME);
}
__name(skipSource, "skipSource");
var SOURCELESS_MAPPING = /* @__PURE__ */ SegmentObject("", -1, -1, "", null, false);
var EMPTY_SOURCES = [];
function SegmentObject(source, line, column, name2, content, ignore) {
  return { source, line, column, name: name2, content, ignore };
}
__name(SegmentObject, "SegmentObject");
function Source(map, sources, source, content, ignore) {
  return {
    map,
    sources,
    source,
    content,
    ignore
  };
}
__name(Source, "Source");
function MapSource(map, sources) {
  return Source(map, sources, "", null, false);
}
__name(MapSource, "MapSource");
function OriginalSource(source, content, ignore) {
  return Source(null, EMPTY_SOURCES, source, content, ignore);
}
__name(OriginalSource, "OriginalSource");
function traceMappings(tree) {
  const gen = new GenMapping({ file: tree.map.file });
  const { sources: rootSources, map } = tree;
  const rootNames = map.names;
  const rootMappings = decodedMappings(map);
  for (let i2 = 0; i2 < rootMappings.length; i2++) {
    const segments = rootMappings[i2];
    for (let j = 0; j < segments.length; j++) {
      const segment = segments[j];
      const genCol = segment[0];
      let traced = SOURCELESS_MAPPING;
      if (segment.length !== 1) {
        const source2 = rootSources[segment[1]];
        traced = originalPositionFor(
          source2,
          segment[2],
          segment[3],
          segment.length === 5 ? rootNames[segment[4]] : ""
        );
        if (traced == null) continue;
      }
      const { column, line, name: name2, content, source, ignore } = traced;
      maybeAddSegment(gen, i2, genCol, source, line, column, name2);
      if (source && content != null) setSourceContent(gen, source, content);
      if (ignore) setIgnore(gen, source, true);
    }
  }
  return gen;
}
__name(traceMappings, "traceMappings");
function originalPositionFor(source, line, column, name2) {
  if (!source.map) {
    return SegmentObject(source.source, line, column, name2, source.content, source.ignore);
  }
  const segment = traceSegment(source.map, line, column);
  if (segment == null) return null;
  if (segment.length === 1) return SOURCELESS_MAPPING;
  return originalPositionFor(
    source.sources[segment[1]],
    segment[2],
    segment[3],
    segment.length === 5 ? source.map.names[segment[4]] : name2
  );
}
__name(originalPositionFor, "originalPositionFor");
function asArray(value) {
  if (Array.isArray(value)) return value;
  return [value];
}
__name(asArray, "asArray");
function buildSourceMapTree(input, loader) {
  const maps = asArray(input).map((m) => new TraceMap(m, ""));
  const map = maps.pop();
  for (let i2 = 0; i2 < maps.length; i2++) {
    if (maps[i2].sources.length > 1) {
      throw new Error(
        `Transformation map ${i2} must have exactly one source file.
Did you specify these with the most recent transformation maps first?`
      );
    }
  }
  let tree = build(map, loader, "", 0);
  for (let i2 = maps.length - 1; i2 >= 0; i2--) {
    tree = MapSource(maps[i2], [tree]);
  }
  return tree;
}
__name(buildSourceMapTree, "buildSourceMapTree");
function build(map, loader, importer, importerDepth) {
  const { resolvedSources, sourcesContent, ignoreList } = map;
  const depth = importerDepth + 1;
  const children = resolvedSources.map((sourceFile, i2) => {
    const ctx = {
      importer,
      depth,
      source: sourceFile || "",
      content: void 0,
      ignore: void 0
    };
    const sourceMap = loader(ctx.source, ctx);
    const { source } = ctx;
    if (sourceMap) return build(new TraceMap(sourceMap, source), loader, source, depth);
    const sourceContent = sourcesContent ? sourcesContent[i2] : null;
    const ignored = ignoreList ? ignoreList.includes(i2) : false;
    return OriginalSource(source, sourceContent, ignored);
  });
  return MapSource(map, children);
}
__name(build, "build");
var SourceMap$1 = (_f = class {
  constructor(map, options) {
    const out = options.decodedMappings ? toDecodedMap(map) : toEncodedMap(map);
    this.version = out.version;
    this.file = out.file;
    this.mappings = out.mappings;
    this.names = out.names;
    this.ignoreList = out.ignoreList;
    this.sourceRoot = out.sourceRoot;
    this.sources = out.sources;
    if (!options.excludeContent) {
      this.sourcesContent = out.sourcesContent;
    }
  }
  toString() {
    return JSON.stringify(this);
  }
}, __name(_f, "SourceMap"), _f);
function remapping(input, loader, options) {
  const opts = { excludeContent: false, decodedMappings: false };
  const tree = buildSourceMapTree(input, loader);
  return new SourceMap$1(traceMappings(tree), opts);
}
__name(remapping, "remapping");
const _BitSet = class _BitSet {
  constructor(arg) {
    this.bits = arg instanceof _BitSet ? arg.bits.slice() : [];
  }
  add(n2) {
    this.bits[n2 >> 5] |= 1 << (n2 & 31);
  }
  has(n2) {
    return !!(this.bits[n2 >> 5] & 1 << (n2 & 31));
  }
};
__name(_BitSet, "BitSet");
let BitSet = _BitSet;
const _Chunk = class _Chunk {
  constructor(start, end, content) {
    this.start = start;
    this.end = end;
    this.original = content;
    this.intro = "";
    this.outro = "";
    this.content = content;
    this.storeName = false;
    this.edited = false;
    {
      this.previous = null;
      this.next = null;
    }
  }
  appendLeft(content) {
    this.outro += content;
  }
  appendRight(content) {
    this.intro = this.intro + content;
  }
  clone() {
    const chunk = new _Chunk(this.start, this.end, this.original);
    chunk.intro = this.intro;
    chunk.outro = this.outro;
    chunk.content = this.content;
    chunk.storeName = this.storeName;
    chunk.edited = this.edited;
    return chunk;
  }
  contains(index) {
    return this.start < index && index < this.end;
  }
  eachNext(fn) {
    let chunk = this;
    while (chunk) {
      fn(chunk);
      chunk = chunk.next;
    }
  }
  eachPrevious(fn) {
    let chunk = this;
    while (chunk) {
      fn(chunk);
      chunk = chunk.previous;
    }
  }
  edit(content, storeName, contentOnly) {
    this.content = content;
    if (!contentOnly) {
      this.intro = "";
      this.outro = "";
    }
    this.storeName = storeName;
    this.edited = true;
    return this;
  }
  prependLeft(content) {
    this.outro = content + this.outro;
  }
  prependRight(content) {
    this.intro = content + this.intro;
  }
  reset() {
    this.intro = "";
    this.outro = "";
    if (this.edited) {
      this.content = this.original;
      this.storeName = false;
      this.edited = false;
    }
  }
  split(index) {
    const sliceIndex = index - this.start;
    const originalBefore = this.original.slice(0, sliceIndex);
    const originalAfter = this.original.slice(sliceIndex);
    this.original = originalBefore;
    const newChunk = new _Chunk(index, this.end, originalAfter);
    newChunk.outro = this.outro;
    this.outro = "";
    this.end = index;
    if (this.edited) {
      newChunk.edit("", false);
      this.content = "";
    } else {
      this.content = originalBefore;
    }
    newChunk.next = this.next;
    if (newChunk.next) newChunk.next.previous = newChunk;
    newChunk.previous = this;
    this.next = newChunk;
    return newChunk;
  }
  toString() {
    return this.intro + this.content + this.outro;
  }
  trimEnd(rx) {
    this.outro = this.outro.replace(rx, "");
    if (this.outro.length) return true;
    const trimmed = this.content.replace(rx, "");
    if (trimmed.length) {
      if (trimmed !== this.content) {
        this.split(this.start + trimmed.length).edit("", void 0, true);
        if (this.edited) {
          this.edit(trimmed, this.storeName, true);
        }
      }
      return true;
    } else {
      this.edit("", void 0, true);
      this.intro = this.intro.replace(rx, "");
      if (this.intro.length) return true;
    }
  }
  trimStart(rx) {
    this.intro = this.intro.replace(rx, "");
    if (this.intro.length) return true;
    const trimmed = this.content.replace(rx, "");
    if (trimmed.length) {
      if (trimmed !== this.content) {
        const newChunk = this.split(this.end - trimmed.length);
        if (this.edited) {
          newChunk.edit(trimmed, this.storeName, true);
        }
        this.edit("", void 0, true);
      }
      return true;
    } else {
      this.edit("", void 0, true);
      this.outro = this.outro.replace(rx, "");
      if (this.outro.length) return true;
    }
  }
};
__name(_Chunk, "Chunk");
let Chunk = _Chunk;
function getBtoa() {
  if (typeof globalThis !== "undefined" && typeof globalThis.btoa === "function") {
    return (str) => globalThis.btoa(unescape(encodeURIComponent(str)));
  } else if (typeof Buffer === "function") {
    return (str) => Buffer.from(str, "utf-8").toString("base64");
  } else {
    return () => {
      throw new Error("Unsupported environment: `window.btoa` or `Buffer` should be supported.");
    };
  }
}
__name(getBtoa, "getBtoa");
const btoa = /* @__PURE__ */ getBtoa();
const _SourceMap = class _SourceMap {
  constructor(properties) {
    this.version = 3;
    this.file = properties.file;
    this.sources = properties.sources;
    this.sourcesContent = properties.sourcesContent;
    this.names = properties.names;
    this.mappings = encode(properties.mappings);
    if (typeof properties.x_google_ignoreList !== "undefined") {
      this.x_google_ignoreList = properties.x_google_ignoreList;
    }
    if (typeof properties.debugId !== "undefined") {
      this.debugId = properties.debugId;
    }
  }
  toString() {
    return JSON.stringify(this);
  }
  toUrl() {
    return "data:application/json;charset=utf-8;base64," + btoa(this.toString());
  }
};
__name(_SourceMap, "SourceMap");
let SourceMap = _SourceMap;
function guessIndent(code) {
  const lines = code.split("\n");
  const tabbed = lines.filter((line) => /^\t+/.test(line));
  const spaced = lines.filter((line) => /^ {2,}/.test(line));
  if (tabbed.length === 0 && spaced.length === 0) {
    return null;
  }
  if (tabbed.length >= spaced.length) {
    return "	";
  }
  const min = spaced.reduce((previous, current) => {
    const numSpaces = /^ +/.exec(current)[0].length;
    return Math.min(numSpaces, previous);
  }, Infinity);
  return new Array(min + 1).join(" ");
}
__name(guessIndent, "guessIndent");
function getRelativePath(from, to) {
  const fromParts = from.split(/[/\\]/);
  const toParts = to.split(/[/\\]/);
  fromParts.pop();
  while (fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  if (fromParts.length) {
    let i2 = fromParts.length;
    while (i2--) fromParts[i2] = "..";
  }
  return fromParts.concat(toParts).join("/");
}
__name(getRelativePath, "getRelativePath");
const toString = Object.prototype.toString;
function isObject(thing) {
  return toString.call(thing) === "[object Object]";
}
__name(isObject, "isObject");
function getLocator(source) {
  const originalLines = source.split("\n");
  const lineOffsets = [];
  for (let i2 = 0, pos = 0; i2 < originalLines.length; i2++) {
    lineOffsets.push(pos);
    pos += originalLines[i2].length + 1;
  }
  return /* @__PURE__ */ __name(function locate(index) {
    let i2 = 0;
    let j = lineOffsets.length;
    while (i2 < j) {
      const m = i2 + j >> 1;
      if (index < lineOffsets[m]) {
        j = m;
      } else {
        i2 = m + 1;
      }
    }
    const line = i2 - 1;
    const column = index - lineOffsets[line];
    return { line, column };
  }, "locate");
}
__name(getLocator, "getLocator");
const wordRegex = /\w/;
const _Mappings = class _Mappings {
  constructor(hires) {
    this.hires = hires;
    this.generatedCodeLine = 0;
    this.generatedCodeColumn = 0;
    this.raw = [];
    this.rawSegments = this.raw[this.generatedCodeLine] = [];
    this.pending = null;
  }
  addEdit(sourceIndex, content, loc, nameIndex) {
    if (content.length) {
      const contentLengthMinusOne = content.length - 1;
      let contentLineEnd = content.indexOf("\n", 0);
      let previousContentLineEnd = -1;
      while (contentLineEnd >= 0 && contentLengthMinusOne > contentLineEnd) {
        const segment2 = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
        if (nameIndex >= 0) {
          segment2.push(nameIndex);
        }
        this.rawSegments.push(segment2);
        this.generatedCodeLine += 1;
        this.raw[this.generatedCodeLine] = this.rawSegments = [];
        this.generatedCodeColumn = 0;
        previousContentLineEnd = contentLineEnd;
        contentLineEnd = content.indexOf("\n", contentLineEnd + 1);
      }
      const segment = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
      if (nameIndex >= 0) {
        segment.push(nameIndex);
      }
      this.rawSegments.push(segment);
      this.advance(content.slice(previousContentLineEnd + 1));
    } else if (this.pending) {
      this.rawSegments.push(this.pending);
      this.advance(content);
    }
    this.pending = null;
  }
  addUneditedChunk(sourceIndex, chunk, original, loc, sourcemapLocations) {
    let originalCharIndex = chunk.start;
    let first = true;
    let charInHiresBoundary = false;
    while (originalCharIndex < chunk.end) {
      if (original[originalCharIndex] === "\n") {
        loc.line += 1;
        loc.column = 0;
        this.generatedCodeLine += 1;
        this.raw[this.generatedCodeLine] = this.rawSegments = [];
        this.generatedCodeColumn = 0;
        first = true;
        charInHiresBoundary = false;
      } else {
        if (this.hires || first || sourcemapLocations.has(originalCharIndex)) {
          const segment = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
          if (this.hires === "boundary") {
            if (wordRegex.test(original[originalCharIndex])) {
              if (!charInHiresBoundary) {
                this.rawSegments.push(segment);
                charInHiresBoundary = true;
              }
            } else {
              this.rawSegments.push(segment);
              charInHiresBoundary = false;
            }
          } else {
            this.rawSegments.push(segment);
          }
        }
        loc.column += 1;
        this.generatedCodeColumn += 1;
        first = false;
      }
      originalCharIndex += 1;
    }
    this.pending = null;
  }
  advance(str) {
    if (!str) return;
    const lines = str.split("\n");
    if (lines.length > 1) {
      for (let i2 = 0; i2 < lines.length - 1; i2++) {
        this.generatedCodeLine++;
        this.raw[this.generatedCodeLine] = this.rawSegments = [];
      }
      this.generatedCodeColumn = 0;
    }
    this.generatedCodeColumn += lines[lines.length - 1].length;
  }
};
__name(_Mappings, "Mappings");
let Mappings = _Mappings;
const n$1 = "\n";
const warned = {
  insertLeft: false,
  insertRight: false,
  storeName: false
};
const _MagicString = class _MagicString {
  constructor(string, options = {}) {
    const chunk = new Chunk(0, string.length, string);
    Object.defineProperties(this, {
      original: { writable: true, value: string },
      outro: { writable: true, value: "" },
      intro: { writable: true, value: "" },
      firstChunk: { writable: true, value: chunk },
      lastChunk: { writable: true, value: chunk },
      lastSearchedChunk: { writable: true, value: chunk },
      byStart: { writable: true, value: {} },
      byEnd: { writable: true, value: {} },
      filename: { writable: true, value: options.filename },
      indentExclusionRanges: { writable: true, value: options.indentExclusionRanges },
      sourcemapLocations: { writable: true, value: new BitSet() },
      storedNames: { writable: true, value: {} },
      indentStr: { writable: true, value: void 0 },
      ignoreList: { writable: true, value: options.ignoreList },
      offset: { writable: true, value: options.offset || 0 }
    });
    this.byStart[0] = chunk;
    this.byEnd[string.length] = chunk;
  }
  addSourcemapLocation(char) {
    this.sourcemapLocations.add(char);
  }
  append(content) {
    if (typeof content !== "string") throw new TypeError("outro content must be a string");
    this.outro += content;
    return this;
  }
  appendLeft(index, content) {
    index = index + this.offset;
    if (typeof content !== "string") throw new TypeError("inserted content must be a string");
    this._split(index);
    const chunk = this.byEnd[index];
    if (chunk) {
      chunk.appendLeft(content);
    } else {
      this.intro += content;
    }
    return this;
  }
  appendRight(index, content) {
    index = index + this.offset;
    if (typeof content !== "string") throw new TypeError("inserted content must be a string");
    this._split(index);
    const chunk = this.byStart[index];
    if (chunk) {
      chunk.appendRight(content);
    } else {
      this.outro += content;
    }
    return this;
  }
  clone() {
    const cloned = new _MagicString(this.original, { filename: this.filename, offset: this.offset });
    let originalChunk = this.firstChunk;
    let clonedChunk = cloned.firstChunk = cloned.lastSearchedChunk = originalChunk.clone();
    while (originalChunk) {
      cloned.byStart[clonedChunk.start] = clonedChunk;
      cloned.byEnd[clonedChunk.end] = clonedChunk;
      const nextOriginalChunk = originalChunk.next;
      const nextClonedChunk = nextOriginalChunk && nextOriginalChunk.clone();
      if (nextClonedChunk) {
        clonedChunk.next = nextClonedChunk;
        nextClonedChunk.previous = clonedChunk;
        clonedChunk = nextClonedChunk;
      }
      originalChunk = nextOriginalChunk;
    }
    cloned.lastChunk = clonedChunk;
    if (this.indentExclusionRanges) {
      cloned.indentExclusionRanges = this.indentExclusionRanges.slice();
    }
    cloned.sourcemapLocations = new BitSet(this.sourcemapLocations);
    cloned.intro = this.intro;
    cloned.outro = this.outro;
    return cloned;
  }
  generateDecodedMap(options) {
    options = options || {};
    const sourceIndex = 0;
    const names = Object.keys(this.storedNames);
    const mappings = new Mappings(options.hires);
    const locate = getLocator(this.original);
    if (this.intro) {
      mappings.advance(this.intro);
    }
    this.firstChunk.eachNext((chunk) => {
      const loc = locate(chunk.start);
      if (chunk.intro.length) mappings.advance(chunk.intro);
      if (chunk.edited) {
        mappings.addEdit(
          sourceIndex,
          chunk.content,
          loc,
          chunk.storeName ? names.indexOf(chunk.original) : -1
        );
      } else {
        mappings.addUneditedChunk(sourceIndex, chunk, this.original, loc, this.sourcemapLocations);
      }
      if (chunk.outro.length) mappings.advance(chunk.outro);
    });
    if (this.outro) {
      mappings.advance(this.outro);
    }
    return {
      file: options.file ? options.file.split(/[/\\]/).pop() : void 0,
      sources: [
        options.source ? getRelativePath(options.file || "", options.source) : options.file || ""
      ],
      sourcesContent: options.includeContent ? [this.original] : void 0,
      names,
      mappings: mappings.raw,
      x_google_ignoreList: this.ignoreList ? [sourceIndex] : void 0
    };
  }
  generateMap(options) {
    return new SourceMap(this.generateDecodedMap(options));
  }
  _ensureindentStr() {
    if (this.indentStr === void 0) {
      this.indentStr = guessIndent(this.original);
    }
  }
  _getRawIndentString() {
    this._ensureindentStr();
    return this.indentStr;
  }
  getIndentString() {
    this._ensureindentStr();
    return this.indentStr === null ? "	" : this.indentStr;
  }
  indent(indentStr, options) {
    const pattern = /^[^\r\n]/gm;
    if (isObject(indentStr)) {
      options = indentStr;
      indentStr = void 0;
    }
    if (indentStr === void 0) {
      this._ensureindentStr();
      indentStr = this.indentStr || "	";
    }
    if (indentStr === "") return this;
    options = options || {};
    const isExcluded = {};
    if (options.exclude) {
      const exclusions = typeof options.exclude[0] === "number" ? [options.exclude] : options.exclude;
      exclusions.forEach((exclusion) => {
        for (let i2 = exclusion[0]; i2 < exclusion[1]; i2 += 1) {
          isExcluded[i2] = true;
        }
      });
    }
    let shouldIndentNextCharacter = options.indentStart !== false;
    const replacer = /* @__PURE__ */ __name((match) => {
      if (shouldIndentNextCharacter) return `${indentStr}${match}`;
      shouldIndentNextCharacter = true;
      return match;
    }, "replacer");
    this.intro = this.intro.replace(pattern, replacer);
    let charIndex = 0;
    let chunk = this.firstChunk;
    while (chunk) {
      const end = chunk.end;
      if (chunk.edited) {
        if (!isExcluded[charIndex]) {
          chunk.content = chunk.content.replace(pattern, replacer);
          if (chunk.content.length) {
            shouldIndentNextCharacter = chunk.content[chunk.content.length - 1] === "\n";
          }
        }
      } else {
        charIndex = chunk.start;
        while (charIndex < end) {
          if (!isExcluded[charIndex]) {
            const char = this.original[charIndex];
            if (char === "\n") {
              shouldIndentNextCharacter = true;
            } else if (char !== "\r" && shouldIndentNextCharacter) {
              shouldIndentNextCharacter = false;
              if (charIndex === chunk.start) {
                chunk.prependRight(indentStr);
              } else {
                this._splitChunk(chunk, charIndex);
                chunk = chunk.next;
                chunk.prependRight(indentStr);
              }
            }
          }
          charIndex += 1;
        }
      }
      charIndex = chunk.end;
      chunk = chunk.next;
    }
    this.outro = this.outro.replace(pattern, replacer);
    return this;
  }
  insert() {
    throw new Error(
      "magicString.insert(...) is deprecated. Use prependRight(...) or appendLeft(...)"
    );
  }
  insertLeft(index, content) {
    if (!warned.insertLeft) {
      console.warn(
        "magicString.insertLeft(...) is deprecated. Use magicString.appendLeft(...) instead"
      );
      warned.insertLeft = true;
    }
    return this.appendLeft(index, content);
  }
  insertRight(index, content) {
    if (!warned.insertRight) {
      console.warn(
        "magicString.insertRight(...) is deprecated. Use magicString.prependRight(...) instead"
      );
      warned.insertRight = true;
    }
    return this.prependRight(index, content);
  }
  move(start, end, index) {
    start = start + this.offset;
    end = end + this.offset;
    index = index + this.offset;
    if (index >= start && index <= end) throw new Error("Cannot move a selection inside itself");
    this._split(start);
    this._split(end);
    this._split(index);
    const first = this.byStart[start];
    const last = this.byEnd[end];
    const oldLeft = first.previous;
    const oldRight = last.next;
    const newRight = this.byStart[index];
    if (!newRight && last === this.lastChunk) return this;
    const newLeft = newRight ? newRight.previous : this.lastChunk;
    if (oldLeft) oldLeft.next = oldRight;
    if (oldRight) oldRight.previous = oldLeft;
    if (newLeft) newLeft.next = first;
    if (newRight) newRight.previous = last;
    if (!first.previous) this.firstChunk = last.next;
    if (!last.next) {
      this.lastChunk = first.previous;
      this.lastChunk.next = null;
    }
    first.previous = newLeft;
    last.next = newRight || null;
    if (!newLeft) this.firstChunk = first;
    if (!newRight) this.lastChunk = last;
    return this;
  }
  overwrite(start, end, content, options) {
    options = options || {};
    return this.update(start, end, content, { ...options, overwrite: !options.contentOnly });
  }
  update(start, end, content, options) {
    start = start + this.offset;
    end = end + this.offset;
    if (typeof content !== "string") throw new TypeError("replacement content must be a string");
    if (this.original.length !== 0) {
      while (start < 0) start += this.original.length;
      while (end < 0) end += this.original.length;
    }
    if (end > this.original.length) throw new Error("end is out of bounds");
    if (start === end)
      throw new Error(
        "Cannot overwrite a zero-length range – use appendLeft or prependRight instead"
      );
    this._split(start);
    this._split(end);
    if (options === true) {
      if (!warned.storeName) {
        console.warn(
          "The final argument to magicString.overwrite(...) should be an options object. See https://github.com/rich-harris/magic-string"
        );
        warned.storeName = true;
      }
      options = { storeName: true };
    }
    const storeName = options !== void 0 ? options.storeName : false;
    const overwrite = options !== void 0 ? options.overwrite : false;
    if (storeName) {
      const original = this.original.slice(start, end);
      Object.defineProperty(this.storedNames, original, {
        writable: true,
        value: true,
        enumerable: true
      });
    }
    const first = this.byStart[start];
    const last = this.byEnd[end];
    if (first) {
      let chunk = first;
      while (chunk !== last) {
        if (chunk.next !== this.byStart[chunk.end]) {
          throw new Error("Cannot overwrite across a split point");
        }
        chunk = chunk.next;
        chunk.edit("", false);
      }
      first.edit(content, storeName, !overwrite);
    } else {
      const newChunk = new Chunk(start, end, "").edit(content, storeName);
      last.next = newChunk;
      newChunk.previous = last;
    }
    return this;
  }
  prepend(content) {
    if (typeof content !== "string") throw new TypeError("outro content must be a string");
    this.intro = content + this.intro;
    return this;
  }
  prependLeft(index, content) {
    index = index + this.offset;
    if (typeof content !== "string") throw new TypeError("inserted content must be a string");
    this._split(index);
    const chunk = this.byEnd[index];
    if (chunk) {
      chunk.prependLeft(content);
    } else {
      this.intro = content + this.intro;
    }
    return this;
  }
  prependRight(index, content) {
    index = index + this.offset;
    if (typeof content !== "string") throw new TypeError("inserted content must be a string");
    this._split(index);
    const chunk = this.byStart[index];
    if (chunk) {
      chunk.prependRight(content);
    } else {
      this.outro = content + this.outro;
    }
    return this;
  }
  remove(start, end) {
    start = start + this.offset;
    end = end + this.offset;
    if (this.original.length !== 0) {
      while (start < 0) start += this.original.length;
      while (end < 0) end += this.original.length;
    }
    if (start === end) return this;
    if (start < 0 || end > this.original.length) throw new Error("Character is out of bounds");
    if (start > end) throw new Error("end must be greater than start");
    this._split(start);
    this._split(end);
    let chunk = this.byStart[start];
    while (chunk) {
      chunk.intro = "";
      chunk.outro = "";
      chunk.edit("");
      chunk = end > chunk.end ? this.byStart[chunk.end] : null;
    }
    return this;
  }
  reset(start, end) {
    start = start + this.offset;
    end = end + this.offset;
    if (this.original.length !== 0) {
      while (start < 0) start += this.original.length;
      while (end < 0) end += this.original.length;
    }
    if (start === end) return this;
    if (start < 0 || end > this.original.length) throw new Error("Character is out of bounds");
    if (start > end) throw new Error("end must be greater than start");
    this._split(start);
    this._split(end);
    let chunk = this.byStart[start];
    while (chunk) {
      chunk.reset();
      chunk = end > chunk.end ? this.byStart[chunk.end] : null;
    }
    return this;
  }
  lastChar() {
    if (this.outro.length) return this.outro[this.outro.length - 1];
    let chunk = this.lastChunk;
    do {
      if (chunk.outro.length) return chunk.outro[chunk.outro.length - 1];
      if (chunk.content.length) return chunk.content[chunk.content.length - 1];
      if (chunk.intro.length) return chunk.intro[chunk.intro.length - 1];
    } while (chunk = chunk.previous);
    if (this.intro.length) return this.intro[this.intro.length - 1];
    return "";
  }
  lastLine() {
    let lineIndex = this.outro.lastIndexOf(n$1);
    if (lineIndex !== -1) return this.outro.substr(lineIndex + 1);
    let lineStr = this.outro;
    let chunk = this.lastChunk;
    do {
      if (chunk.outro.length > 0) {
        lineIndex = chunk.outro.lastIndexOf(n$1);
        if (lineIndex !== -1) return chunk.outro.substr(lineIndex + 1) + lineStr;
        lineStr = chunk.outro + lineStr;
      }
      if (chunk.content.length > 0) {
        lineIndex = chunk.content.lastIndexOf(n$1);
        if (lineIndex !== -1) return chunk.content.substr(lineIndex + 1) + lineStr;
        lineStr = chunk.content + lineStr;
      }
      if (chunk.intro.length > 0) {
        lineIndex = chunk.intro.lastIndexOf(n$1);
        if (lineIndex !== -1) return chunk.intro.substr(lineIndex + 1) + lineStr;
        lineStr = chunk.intro + lineStr;
      }
    } while (chunk = chunk.previous);
    lineIndex = this.intro.lastIndexOf(n$1);
    if (lineIndex !== -1) return this.intro.substr(lineIndex + 1) + lineStr;
    return this.intro + lineStr;
  }
  slice(start = 0, end = this.original.length - this.offset) {
    start = start + this.offset;
    end = end + this.offset;
    if (this.original.length !== 0) {
      while (start < 0) start += this.original.length;
      while (end < 0) end += this.original.length;
    }
    let result = "";
    let chunk = this.firstChunk;
    while (chunk && (chunk.start > start || chunk.end <= start)) {
      if (chunk.start < end && chunk.end >= end) {
        return result;
      }
      chunk = chunk.next;
    }
    if (chunk && chunk.edited && chunk.start !== start)
      throw new Error(`Cannot use replaced character ${start} as slice start anchor.`);
    const startChunk = chunk;
    while (chunk) {
      if (chunk.intro && (startChunk !== chunk || chunk.start === start)) {
        result += chunk.intro;
      }
      const containsEnd = chunk.start < end && chunk.end >= end;
      if (containsEnd && chunk.edited && chunk.end !== end)
        throw new Error(`Cannot use replaced character ${end} as slice end anchor.`);
      const sliceStart = startChunk === chunk ? start - chunk.start : 0;
      const sliceEnd = containsEnd ? chunk.content.length + end - chunk.end : chunk.content.length;
      result += chunk.content.slice(sliceStart, sliceEnd);
      if (chunk.outro && (!containsEnd || chunk.end === end)) {
        result += chunk.outro;
      }
      if (containsEnd) {
        break;
      }
      chunk = chunk.next;
    }
    return result;
  }
  // TODO deprecate this? not really very useful
  snip(start, end) {
    const clone = this.clone();
    clone.remove(0, start);
    clone.remove(end, clone.original.length);
    return clone;
  }
  _split(index) {
    if (this.byStart[index] || this.byEnd[index]) return;
    let chunk = this.lastSearchedChunk;
    let previousChunk = chunk;
    const searchForward = index > chunk.end;
    while (chunk) {
      if (chunk.contains(index)) return this._splitChunk(chunk, index);
      chunk = searchForward ? this.byStart[chunk.end] : this.byEnd[chunk.start];
      if (chunk === previousChunk) return;
      previousChunk = chunk;
    }
  }
  _splitChunk(chunk, index) {
    if (chunk.edited && chunk.content.length) {
      const loc = getLocator(this.original)(index);
      throw new Error(
        `Cannot split a chunk that has already been edited (${loc.line}:${loc.column} – "${chunk.original}")`
      );
    }
    const newChunk = chunk.split(index);
    this.byEnd[index] = chunk;
    this.byStart[index] = newChunk;
    this.byEnd[newChunk.end] = newChunk;
    if (chunk === this.lastChunk) this.lastChunk = newChunk;
    this.lastSearchedChunk = chunk;
    return true;
  }
  toString() {
    let str = this.intro;
    let chunk = this.firstChunk;
    while (chunk) {
      str += chunk.toString();
      chunk = chunk.next;
    }
    return str + this.outro;
  }
  isEmpty() {
    let chunk = this.firstChunk;
    do {
      if (chunk.intro.length && chunk.intro.trim() || chunk.content.length && chunk.content.trim() || chunk.outro.length && chunk.outro.trim())
        return false;
    } while (chunk = chunk.next);
    return true;
  }
  length() {
    let chunk = this.firstChunk;
    let length = 0;
    do {
      length += chunk.intro.length + chunk.content.length + chunk.outro.length;
    } while (chunk = chunk.next);
    return length;
  }
  trimLines() {
    return this.trim("[\\r\\n]");
  }
  trim(charType) {
    return this.trimStart(charType).trimEnd(charType);
  }
  trimEndAborted(charType) {
    const rx = new RegExp((charType || "\\s") + "+$");
    this.outro = this.outro.replace(rx, "");
    if (this.outro.length) return true;
    let chunk = this.lastChunk;
    do {
      const end = chunk.end;
      const aborted = chunk.trimEnd(rx);
      if (chunk.end !== end) {
        if (this.lastChunk === chunk) {
          this.lastChunk = chunk.next;
        }
        this.byEnd[chunk.end] = chunk;
        this.byStart[chunk.next.start] = chunk.next;
        this.byEnd[chunk.next.end] = chunk.next;
      }
      if (aborted) return true;
      chunk = chunk.previous;
    } while (chunk);
    return false;
  }
  trimEnd(charType) {
    this.trimEndAborted(charType);
    return this;
  }
  trimStartAborted(charType) {
    const rx = new RegExp("^" + (charType || "\\s") + "+");
    this.intro = this.intro.replace(rx, "");
    if (this.intro.length) return true;
    let chunk = this.firstChunk;
    do {
      const end = chunk.end;
      const aborted = chunk.trimStart(rx);
      if (chunk.end !== end) {
        if (chunk === this.lastChunk) this.lastChunk = chunk.next;
        this.byEnd[chunk.end] = chunk;
        this.byStart[chunk.next.start] = chunk.next;
        this.byEnd[chunk.next.end] = chunk.next;
      }
      if (aborted) return true;
      chunk = chunk.next;
    } while (chunk);
    return false;
  }
  trimStart(charType) {
    this.trimStartAborted(charType);
    return this;
  }
  hasChanged() {
    return this.original !== this.toString();
  }
  _replaceRegexp(searchValue, replacement) {
    function getReplacement(match, str) {
      if (typeof replacement === "string") {
        return replacement.replace(/\$(\$|&|\d+)/g, (_, i2) => {
          if (i2 === "$") return "$";
          if (i2 === "&") return match[0];
          const num = +i2;
          if (num < match.length) return match[+i2];
          return `$${i2}`;
        });
      } else {
        return replacement(...match, match.index, str, match.groups);
      }
    }
    __name(getReplacement, "getReplacement");
    function matchAll(re, str) {
      let match;
      const matches = [];
      while (match = re.exec(str)) {
        matches.push(match);
      }
      return matches;
    }
    __name(matchAll, "matchAll");
    if (searchValue.global) {
      const matches = matchAll(searchValue, this.original);
      matches.forEach((match) => {
        if (match.index != null) {
          const replacement2 = getReplacement(match, this.original);
          if (replacement2 !== match[0]) {
            this.overwrite(match.index, match.index + match[0].length, replacement2);
          }
        }
      });
    } else {
      const match = this.original.match(searchValue);
      if (match && match.index != null) {
        const replacement2 = getReplacement(match, this.original);
        if (replacement2 !== match[0]) {
          this.overwrite(match.index, match.index + match[0].length, replacement2);
        }
      }
    }
    return this;
  }
  _replaceString(string, replacement) {
    const { original } = this;
    const index = original.indexOf(string);
    if (index !== -1) {
      if (typeof replacement === "function") {
        replacement = replacement(string, index, original);
      }
      if (string !== replacement) {
        this.overwrite(index, index + string.length, replacement);
      }
    }
    return this;
  }
  replace(searchValue, replacement) {
    if (typeof searchValue === "string") {
      return this._replaceString(searchValue, replacement);
    }
    return this._replaceRegexp(searchValue, replacement);
  }
  _replaceAllString(string, replacement) {
    const { original } = this;
    const stringLength = string.length;
    for (let index = original.indexOf(string); index !== -1; index = original.indexOf(string, index + stringLength)) {
      const previous = original.slice(index, index + stringLength);
      let _replacement = replacement;
      if (typeof replacement === "function") {
        _replacement = replacement(previous, index, original);
      }
      if (previous !== _replacement) this.overwrite(index, index + stringLength, _replacement);
    }
    return this;
  }
  replaceAll(searchValue, replacement) {
    if (typeof searchValue === "string") {
      return this._replaceAllString(searchValue, replacement);
    }
    if (!searchValue.global) {
      throw new TypeError(
        "MagicString.prototype.replaceAll called with a non-global RegExp argument"
      );
    }
    return this._replaceRegexp(searchValue, replacement);
  }
};
__name(_MagicString, "MagicString");
let MagicString = _MagicString;
var sourceMapGenerator = {};
var base64Vlq = {};
var base64$1 = {};
var intToCharMap = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");
base64$1.encode = function(number) {
  if (0 <= number && number < intToCharMap.length) {
    return intToCharMap[number];
  }
  throw new TypeError("Must be between 0 and 63: " + number);
};
base64$1.decode = function(charCode) {
  var bigA = 65;
  var bigZ = 90;
  var littleA = 97;
  var littleZ = 122;
  var zero = 48;
  var nine = 57;
  var plus = 43;
  var slash = 47;
  var littleOffset = 26;
  var numberOffset = 52;
  if (bigA <= charCode && charCode <= bigZ) {
    return charCode - bigA;
  }
  if (littleA <= charCode && charCode <= littleZ) {
    return charCode - littleA + littleOffset;
  }
  if (zero <= charCode && charCode <= nine) {
    return charCode - zero + numberOffset;
  }
  if (charCode == plus) {
    return 62;
  }
  if (charCode == slash) {
    return 63;
  }
  return -1;
};
var base64 = base64$1;
var VLQ_BASE_SHIFT = 5;
var VLQ_BASE = 1 << VLQ_BASE_SHIFT;
var VLQ_BASE_MASK = VLQ_BASE - 1;
var VLQ_CONTINUATION_BIT = VLQ_BASE;
function toVLQSigned(aValue) {
  return aValue < 0 ? (-aValue << 1) + 1 : (aValue << 1) + 0;
}
__name(toVLQSigned, "toVLQSigned");
function fromVLQSigned(aValue) {
  var isNegative = (aValue & 1) === 1;
  var shifted = aValue >> 1;
  return isNegative ? -shifted : shifted;
}
__name(fromVLQSigned, "fromVLQSigned");
base64Vlq.encode = /* @__PURE__ */ __name(function base64VLQ_encode(aValue) {
  var encoded = "";
  var digit;
  var vlq = toVLQSigned(aValue);
  do {
    digit = vlq & VLQ_BASE_MASK;
    vlq >>>= VLQ_BASE_SHIFT;
    if (vlq > 0) {
      digit |= VLQ_CONTINUATION_BIT;
    }
    encoded += base64.encode(digit);
  } while (vlq > 0);
  return encoded;
}, "base64VLQ_encode");
base64Vlq.decode = /* @__PURE__ */ __name(function base64VLQ_decode(aStr, aIndex, aOutParam) {
  var strLen = aStr.length;
  var result = 0;
  var shift = 0;
  var continuation, digit;
  do {
    if (aIndex >= strLen) {
      throw new Error("Expected more digits in base 64 VLQ value.");
    }
    digit = base64.decode(aStr.charCodeAt(aIndex++));
    if (digit === -1) {
      throw new Error("Invalid base64 digit: " + aStr.charAt(aIndex - 1));
    }
    continuation = !!(digit & VLQ_CONTINUATION_BIT);
    digit &= VLQ_BASE_MASK;
    result = result + (digit << shift);
    shift += VLQ_BASE_SHIFT;
  } while (continuation);
  aOutParam.value = fromVLQSigned(result);
  aOutParam.rest = aIndex;
}, "base64VLQ_decode");
var util$3 = {};
(function(exports) {
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  __name(getArg, "getArg");
  exports.getArg = getArg;
  var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.-]*)(?::(\d+))?(.*)$/;
  var dataUrlRegexp = /^data:.+\,.+$/;
  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[2],
      host: match[3],
      port: match[4],
      path: match[5]
    };
  }
  __name(urlParse, "urlParse");
  exports.urlParse = urlParse;
  function urlGenerate(aParsedUrl) {
    var url = "";
    if (aParsedUrl.scheme) {
      url += aParsedUrl.scheme + ":";
    }
    url += "//";
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + "@";
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port;
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  __name(urlGenerate, "urlGenerate");
  exports.urlGenerate = urlGenerate;
  var MAX_CACHED_INPUTS = 32;
  function lruMemoize(f2) {
    var cache = [];
    return function(input) {
      for (var i2 = 0; i2 < cache.length; i2++) {
        if (cache[i2].input === input) {
          var temp = cache[0];
          cache[0] = cache[i2];
          cache[i2] = temp;
          return cache[0].result;
        }
      }
      var result = f2(input);
      cache.unshift({
        input,
        result
      });
      if (cache.length > MAX_CACHED_INPUTS) {
        cache.pop();
      }
      return result;
    };
  }
  __name(lruMemoize, "lruMemoize");
  var normalize = lruMemoize(/* @__PURE__ */ __name(function normalize2(aPath) {
    var path2 = aPath;
    var url = urlParse(aPath);
    if (url) {
      if (!url.path) {
        return aPath;
      }
      path2 = url.path;
    }
    var isAbsolute = exports.isAbsolute(path2);
    var parts = [];
    var start = 0;
    var i2 = 0;
    while (true) {
      start = i2;
      i2 = path2.indexOf("/", start);
      if (i2 === -1) {
        parts.push(path2.slice(start));
        break;
      } else {
        parts.push(path2.slice(start, i2));
        while (i2 < path2.length && path2[i2] === "/") {
          i2++;
        }
      }
    }
    for (var part, up = 0, i2 = parts.length - 1; i2 >= 0; i2--) {
      part = parts[i2];
      if (part === ".") {
        parts.splice(i2, 1);
      } else if (part === "..") {
        up++;
      } else if (up > 0) {
        if (part === "") {
          parts.splice(i2 + 1, up);
          up = 0;
        } else {
          parts.splice(i2, 2);
          up--;
        }
      }
    }
    path2 = parts.join("/");
    if (path2 === "") {
      path2 = isAbsolute ? "/" : ".";
    }
    if (url) {
      url.path = path2;
      return urlGenerate(url);
    }
    return path2;
  }, "normalize"));
  exports.normalize = normalize;
  function join(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }
    if (aPath === "") {
      aPath = ".";
    }
    var aPathUrl = urlParse(aPath);
    var aRootUrl = urlParse(aRoot);
    if (aRootUrl) {
      aRoot = aRootUrl.path || "/";
    }
    if (aPathUrl && !aPathUrl.scheme) {
      if (aRootUrl) {
        aPathUrl.scheme = aRootUrl.scheme;
      }
      return urlGenerate(aPathUrl);
    }
    if (aPathUrl || aPath.match(dataUrlRegexp)) {
      return aPath;
    }
    if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
      aRootUrl.host = aPath;
      return urlGenerate(aRootUrl);
    }
    var joined = aPath.charAt(0) === "/" ? aPath : normalize(aRoot.replace(/\/+$/, "") + "/" + aPath);
    if (aRootUrl) {
      aRootUrl.path = joined;
      return urlGenerate(aRootUrl);
    }
    return joined;
  }
  __name(join, "join");
  exports.join = join;
  exports.isAbsolute = function(aPath) {
    return aPath.charAt(0) === "/" || urlRegexp.test(aPath);
  };
  function relative(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }
    aRoot = aRoot.replace(/\/$/, "");
    var level = 0;
    while (aPath.indexOf(aRoot + "/") !== 0) {
      var index = aRoot.lastIndexOf("/");
      if (index < 0) {
        return aPath;
      }
      aRoot = aRoot.slice(0, index);
      if (aRoot.match(/^([^\/]+:\/)?\/*$/)) {
        return aPath;
      }
      ++level;
    }
    return Array(level + 1).join("../") + aPath.substr(aRoot.length + 1);
  }
  __name(relative, "relative");
  exports.relative = relative;
  var supportsNullProto = function() {
    var obj = /* @__PURE__ */ Object.create(null);
    return !("__proto__" in obj);
  }();
  function identity(s) {
    return s;
  }
  __name(identity, "identity");
  function toSetString(aStr) {
    if (isProtoString(aStr)) {
      return "$" + aStr;
    }
    return aStr;
  }
  __name(toSetString, "toSetString");
  exports.toSetString = supportsNullProto ? identity : toSetString;
  function fromSetString(aStr) {
    if (isProtoString(aStr)) {
      return aStr.slice(1);
    }
    return aStr;
  }
  __name(fromSetString, "fromSetString");
  exports.fromSetString = supportsNullProto ? identity : fromSetString;
  function isProtoString(s) {
    if (!s) {
      return false;
    }
    var length = s.length;
    if (length < 9) {
      return false;
    }
    if (s.charCodeAt(length - 1) !== 95 || s.charCodeAt(length - 2) !== 95 || s.charCodeAt(length - 3) !== 111 || s.charCodeAt(length - 4) !== 116 || s.charCodeAt(length - 5) !== 111 || s.charCodeAt(length - 6) !== 114 || s.charCodeAt(length - 7) !== 112 || s.charCodeAt(length - 8) !== 95 || s.charCodeAt(length - 9) !== 95) {
      return false;
    }
    for (var i2 = length - 10; i2 >= 0; i2--) {
      if (s.charCodeAt(i2) !== 36) {
        return false;
      }
    }
    return true;
  }
  __name(isProtoString, "isProtoString");
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0 || onlyCompareOriginal) {
      return cmp;
    }
    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }
    return strcmp(mappingA.name, mappingB.name);
  }
  __name(compareByOriginalPositions, "compareByOriginalPositions");
  exports.compareByOriginalPositions = compareByOriginalPositions;
  function compareByOriginalPositionsNoSource(mappingA, mappingB, onlyCompareOriginal) {
    var cmp;
    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0 || onlyCompareOriginal) {
      return cmp;
    }
    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }
    return strcmp(mappingA.name, mappingB.name);
  }
  __name(compareByOriginalPositionsNoSource, "compareByOriginalPositionsNoSource");
  exports.compareByOriginalPositionsNoSource = compareByOriginalPositionsNoSource;
  function compareByGeneratedPositionsDeflated(mappingA, mappingB, onlyCompareGenerated) {
    var cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0 || onlyCompareGenerated) {
      return cmp;
    }
    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0) {
      return cmp;
    }
    return strcmp(mappingA.name, mappingB.name);
  }
  __name(compareByGeneratedPositionsDeflated, "compareByGeneratedPositionsDeflated");
  exports.compareByGeneratedPositionsDeflated = compareByGeneratedPositionsDeflated;
  function compareByGeneratedPositionsDeflatedNoLine(mappingA, mappingB, onlyCompareGenerated) {
    var cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0 || onlyCompareGenerated) {
      return cmp;
    }
    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0) {
      return cmp;
    }
    return strcmp(mappingA.name, mappingB.name);
  }
  __name(compareByGeneratedPositionsDeflatedNoLine, "compareByGeneratedPositionsDeflatedNoLine");
  exports.compareByGeneratedPositionsDeflatedNoLine = compareByGeneratedPositionsDeflatedNoLine;
  function strcmp(aStr1, aStr2) {
    if (aStr1 === aStr2) {
      return 0;
    }
    if (aStr1 === null) {
      return 1;
    }
    if (aStr2 === null) {
      return -1;
    }
    if (aStr1 > aStr2) {
      return 1;
    }
    return -1;
  }
  __name(strcmp, "strcmp");
  function compareByGeneratedPositionsInflated(mappingA, mappingB) {
    var cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp !== 0) {
      return cmp;
    }
    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp !== 0) {
      return cmp;
    }
    return strcmp(mappingA.name, mappingB.name);
  }
  __name(compareByGeneratedPositionsInflated, "compareByGeneratedPositionsInflated");
  exports.compareByGeneratedPositionsInflated = compareByGeneratedPositionsInflated;
  function parseSourceMapInput(str) {
    return JSON.parse(str.replace(/^\)]}'[^\n]*\n/, ""));
  }
  __name(parseSourceMapInput, "parseSourceMapInput");
  exports.parseSourceMapInput = parseSourceMapInput;
  function computeSourceURL(sourceRoot, sourceURL, sourceMapURL) {
    sourceURL = sourceURL || "";
    if (sourceRoot) {
      if (sourceRoot[sourceRoot.length - 1] !== "/" && sourceURL[0] !== "/") {
        sourceRoot += "/";
      }
      sourceURL = sourceRoot + sourceURL;
    }
    if (sourceMapURL) {
      var parsed = urlParse(sourceMapURL);
      if (!parsed) {
        throw new Error("sourceMapURL could not be parsed");
      }
      if (parsed.path) {
        var index = parsed.path.lastIndexOf("/");
        if (index >= 0) {
          parsed.path = parsed.path.substring(0, index + 1);
        }
      }
      sourceURL = join(urlGenerate(parsed), sourceURL);
    }
    return normalize(sourceURL);
  }
  __name(computeSourceURL, "computeSourceURL");
  exports.computeSourceURL = computeSourceURL;
})(util$3);
var arraySet = {};
var util$2 = util$3;
var has = Object.prototype.hasOwnProperty;
var hasNativeMap = typeof Map !== "undefined";
function ArraySet$1() {
  this._array = [];
  this._set = hasNativeMap ? /* @__PURE__ */ new Map() : /* @__PURE__ */ Object.create(null);
}
__name(ArraySet$1, "ArraySet$1");
ArraySet$1.fromArray = /* @__PURE__ */ __name(function ArraySet_fromArray(aArray, aAllowDuplicates) {
  var set = new ArraySet$1();
  for (var i2 = 0, len = aArray.length; i2 < len; i2++) {
    set.add(aArray[i2], aAllowDuplicates);
  }
  return set;
}, "ArraySet_fromArray");
ArraySet$1.prototype.size = /* @__PURE__ */ __name(function ArraySet_size() {
  return hasNativeMap ? this._set.size : Object.getOwnPropertyNames(this._set).length;
}, "ArraySet_size");
ArraySet$1.prototype.add = /* @__PURE__ */ __name(function ArraySet_add(aStr, aAllowDuplicates) {
  var sStr = hasNativeMap ? aStr : util$2.toSetString(aStr);
  var isDuplicate = hasNativeMap ? this.has(aStr) : has.call(this._set, sStr);
  var idx = this._array.length;
  if (!isDuplicate || aAllowDuplicates) {
    this._array.push(aStr);
  }
  if (!isDuplicate) {
    if (hasNativeMap) {
      this._set.set(aStr, idx);
    } else {
      this._set[sStr] = idx;
    }
  }
}, "ArraySet_add");
ArraySet$1.prototype.has = /* @__PURE__ */ __name(function ArraySet_has(aStr) {
  if (hasNativeMap) {
    return this._set.has(aStr);
  } else {
    var sStr = util$2.toSetString(aStr);
    return has.call(this._set, sStr);
  }
}, "ArraySet_has");
ArraySet$1.prototype.indexOf = /* @__PURE__ */ __name(function ArraySet_indexOf(aStr) {
  if (hasNativeMap) {
    var idx = this._set.get(aStr);
    if (idx >= 0) {
      return idx;
    }
  } else {
    var sStr = util$2.toSetString(aStr);
    if (has.call(this._set, sStr)) {
      return this._set[sStr];
    }
  }
  throw new Error('"' + aStr + '" is not in the set.');
}, "ArraySet_indexOf");
ArraySet$1.prototype.at = /* @__PURE__ */ __name(function ArraySet_at(aIdx) {
  if (aIdx >= 0 && aIdx < this._array.length) {
    return this._array[aIdx];
  }
  throw new Error("No element indexed by " + aIdx);
}, "ArraySet_at");
ArraySet$1.prototype.toArray = /* @__PURE__ */ __name(function ArraySet_toArray() {
  return this._array.slice();
}, "ArraySet_toArray");
arraySet.ArraySet = ArraySet$1;
var mappingList = {};
var util$1 = util$3;
function generatedPositionAfter(mappingA, mappingB) {
  var lineA = mappingA.generatedLine;
  var lineB = mappingB.generatedLine;
  var columnA = mappingA.generatedColumn;
  var columnB = mappingB.generatedColumn;
  return lineB > lineA || lineB == lineA && columnB >= columnA || util$1.compareByGeneratedPositionsInflated(mappingA, mappingB) <= 0;
}
__name(generatedPositionAfter, "generatedPositionAfter");
function MappingList$1() {
  this._array = [];
  this._sorted = true;
  this._last = { generatedLine: -1, generatedColumn: 0 };
}
__name(MappingList$1, "MappingList$1");
MappingList$1.prototype.unsortedForEach = /* @__PURE__ */ __name(function MappingList_forEach(aCallback, aThisArg) {
  this._array.forEach(aCallback, aThisArg);
}, "MappingList_forEach");
MappingList$1.prototype.add = /* @__PURE__ */ __name(function MappingList_add(aMapping) {
  if (generatedPositionAfter(this._last, aMapping)) {
    this._last = aMapping;
    this._array.push(aMapping);
  } else {
    this._sorted = false;
    this._array.push(aMapping);
  }
}, "MappingList_add");
MappingList$1.prototype.toArray = /* @__PURE__ */ __name(function MappingList_toArray() {
  if (!this._sorted) {
    this._array.sort(util$1.compareByGeneratedPositionsInflated);
    this._sorted = true;
  }
  return this._array;
}, "MappingList_toArray");
mappingList.MappingList = MappingList$1;
var base64VLQ = base64Vlq;
var util = util$3;
var ArraySet = arraySet.ArraySet;
var MappingList = mappingList.MappingList;
function SourceMapGenerator$1(aArgs) {
  if (!aArgs) {
    aArgs = {};
  }
  this._file = util.getArg(aArgs, "file", null);
  this._sourceRoot = util.getArg(aArgs, "sourceRoot", null);
  this._skipValidation = util.getArg(aArgs, "skipValidation", false);
  this._ignoreInvalidMapping = util.getArg(aArgs, "ignoreInvalidMapping", false);
  this._sources = new ArraySet();
  this._names = new ArraySet();
  this._mappings = new MappingList();
  this._sourcesContents = null;
}
__name(SourceMapGenerator$1, "SourceMapGenerator$1");
SourceMapGenerator$1.prototype._version = 3;
SourceMapGenerator$1.fromSourceMap = /* @__PURE__ */ __name(function SourceMapGenerator_fromSourceMap(aSourceMapConsumer, generatorOps) {
  var sourceRoot = aSourceMapConsumer.sourceRoot;
  var generator = new SourceMapGenerator$1(Object.assign(generatorOps || {}, {
    file: aSourceMapConsumer.file,
    sourceRoot
  }));
  aSourceMapConsumer.eachMapping(function(mapping) {
    var newMapping = {
      generated: {
        line: mapping.generatedLine,
        column: mapping.generatedColumn
      }
    };
    if (mapping.source != null) {
      newMapping.source = mapping.source;
      if (sourceRoot != null) {
        newMapping.source = util.relative(sourceRoot, newMapping.source);
      }
      newMapping.original = {
        line: mapping.originalLine,
        column: mapping.originalColumn
      };
      if (mapping.name != null) {
        newMapping.name = mapping.name;
      }
    }
    generator.addMapping(newMapping);
  });
  aSourceMapConsumer.sources.forEach(function(sourceFile) {
    var sourceRelative = sourceFile;
    if (sourceRoot !== null) {
      sourceRelative = util.relative(sourceRoot, sourceFile);
    }
    if (!generator._sources.has(sourceRelative)) {
      generator._sources.add(sourceRelative);
    }
    var content = aSourceMapConsumer.sourceContentFor(sourceFile);
    if (content != null) {
      generator.setSourceContent(sourceFile, content);
    }
  });
  return generator;
}, "SourceMapGenerator_fromSourceMap");
SourceMapGenerator$1.prototype.addMapping = /* @__PURE__ */ __name(function SourceMapGenerator_addMapping(aArgs) {
  var generated = util.getArg(aArgs, "generated");
  var original = util.getArg(aArgs, "original", null);
  var source = util.getArg(aArgs, "source", null);
  var name2 = util.getArg(aArgs, "name", null);
  if (!this._skipValidation) {
    if (this._validateMapping(generated, original, source, name2) === false) {
      return;
    }
  }
  if (source != null) {
    source = String(source);
    if (!this._sources.has(source)) {
      this._sources.add(source);
    }
  }
  if (name2 != null) {
    name2 = String(name2);
    if (!this._names.has(name2)) {
      this._names.add(name2);
    }
  }
  this._mappings.add({
    generatedLine: generated.line,
    generatedColumn: generated.column,
    originalLine: original != null && original.line,
    originalColumn: original != null && original.column,
    source,
    name: name2
  });
}, "SourceMapGenerator_addMapping");
SourceMapGenerator$1.prototype.setSourceContent = /* @__PURE__ */ __name(function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
  var source = aSourceFile;
  if (this._sourceRoot != null) {
    source = util.relative(this._sourceRoot, source);
  }
  if (aSourceContent != null) {
    if (!this._sourcesContents) {
      this._sourcesContents = /* @__PURE__ */ Object.create(null);
    }
    this._sourcesContents[util.toSetString(source)] = aSourceContent;
  } else if (this._sourcesContents) {
    delete this._sourcesContents[util.toSetString(source)];
    if (Object.keys(this._sourcesContents).length === 0) {
      this._sourcesContents = null;
    }
  }
}, "SourceMapGenerator_setSourceContent");
SourceMapGenerator$1.prototype.applySourceMap = /* @__PURE__ */ __name(function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
  var sourceFile = aSourceFile;
  if (aSourceFile == null) {
    if (aSourceMapConsumer.file == null) {
      throw new Error(
        `SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, or the source map's "file" property. Both were omitted.`
      );
    }
    sourceFile = aSourceMapConsumer.file;
  }
  var sourceRoot = this._sourceRoot;
  if (sourceRoot != null) {
    sourceFile = util.relative(sourceRoot, sourceFile);
  }
  var newSources = new ArraySet();
  var newNames = new ArraySet();
  this._mappings.unsortedForEach(function(mapping) {
    if (mapping.source === sourceFile && mapping.originalLine != null) {
      var original = aSourceMapConsumer.originalPositionFor({
        line: mapping.originalLine,
        column: mapping.originalColumn
      });
      if (original.source != null) {
        mapping.source = original.source;
        if (aSourceMapPath != null) {
          mapping.source = util.join(aSourceMapPath, mapping.source);
        }
        if (sourceRoot != null) {
          mapping.source = util.relative(sourceRoot, mapping.source);
        }
        mapping.originalLine = original.line;
        mapping.originalColumn = original.column;
        if (original.name != null) {
          mapping.name = original.name;
        }
      }
    }
    var source = mapping.source;
    if (source != null && !newSources.has(source)) {
      newSources.add(source);
    }
    var name2 = mapping.name;
    if (name2 != null && !newNames.has(name2)) {
      newNames.add(name2);
    }
  }, this);
  this._sources = newSources;
  this._names = newNames;
  aSourceMapConsumer.sources.forEach(function(sourceFile2) {
    var content = aSourceMapConsumer.sourceContentFor(sourceFile2);
    if (content != null) {
      if (aSourceMapPath != null) {
        sourceFile2 = util.join(aSourceMapPath, sourceFile2);
      }
      if (sourceRoot != null) {
        sourceFile2 = util.relative(sourceRoot, sourceFile2);
      }
      this.setSourceContent(sourceFile2, content);
    }
  }, this);
}, "SourceMapGenerator_applySourceMap");
SourceMapGenerator$1.prototype._validateMapping = /* @__PURE__ */ __name(function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource, aName) {
  if (aOriginal && typeof aOriginal.line !== "number" && typeof aOriginal.column !== "number") {
    var message = "original.line and original.column are not numbers -- you probably meant to omit the original mapping entirely and only map the generated position. If so, pass null for the original mapping instead of an object with empty or null values.";
    if (this._ignoreInvalidMapping) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(message);
      }
      return false;
    } else {
      throw new Error(message);
    }
  }
  if (aGenerated && "line" in aGenerated && "column" in aGenerated && aGenerated.line > 0 && aGenerated.column >= 0 && !aOriginal && !aSource && !aName) {
    return;
  } else if (aGenerated && "line" in aGenerated && "column" in aGenerated && aOriginal && "line" in aOriginal && "column" in aOriginal && aGenerated.line > 0 && aGenerated.column >= 0 && aOriginal.line > 0 && aOriginal.column >= 0 && aSource) {
    return;
  } else {
    var message = "Invalid mapping: " + JSON.stringify({
      generated: aGenerated,
      source: aSource,
      original: aOriginal,
      name: aName
    });
    if (this._ignoreInvalidMapping) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn(message);
      }
      return false;
    } else {
      throw new Error(message);
    }
  }
}, "SourceMapGenerator_validateMapping");
SourceMapGenerator$1.prototype._serializeMappings = /* @__PURE__ */ __name(function SourceMapGenerator_serializeMappings() {
  var previousGeneratedColumn = 0;
  var previousGeneratedLine = 1;
  var previousOriginalColumn = 0;
  var previousOriginalLine = 0;
  var previousName = 0;
  var previousSource = 0;
  var result = "";
  var next;
  var mapping;
  var nameIdx;
  var sourceIdx;
  var mappings = this._mappings.toArray();
  for (var i2 = 0, len = mappings.length; i2 < len; i2++) {
    mapping = mappings[i2];
    next = "";
    if (mapping.generatedLine !== previousGeneratedLine) {
      previousGeneratedColumn = 0;
      while (mapping.generatedLine !== previousGeneratedLine) {
        next += ";";
        previousGeneratedLine++;
      }
    } else {
      if (i2 > 0) {
        if (!util.compareByGeneratedPositionsInflated(mapping, mappings[i2 - 1])) {
          continue;
        }
        next += ",";
      }
    }
    next += base64VLQ.encode(mapping.generatedColumn - previousGeneratedColumn);
    previousGeneratedColumn = mapping.generatedColumn;
    if (mapping.source != null) {
      sourceIdx = this._sources.indexOf(mapping.source);
      next += base64VLQ.encode(sourceIdx - previousSource);
      previousSource = sourceIdx;
      next += base64VLQ.encode(mapping.originalLine - 1 - previousOriginalLine);
      previousOriginalLine = mapping.originalLine - 1;
      next += base64VLQ.encode(mapping.originalColumn - previousOriginalColumn);
      previousOriginalColumn = mapping.originalColumn;
      if (mapping.name != null) {
        nameIdx = this._names.indexOf(mapping.name);
        next += base64VLQ.encode(nameIdx - previousName);
        previousName = nameIdx;
      }
    }
    result += next;
  }
  return result;
}, "SourceMapGenerator_serializeMappings");
SourceMapGenerator$1.prototype._generateSourcesContent = /* @__PURE__ */ __name(function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
  return aSources.map(function(source) {
    if (!this._sourcesContents) {
      return null;
    }
    if (aSourceRoot != null) {
      source = util.relative(aSourceRoot, source);
    }
    var key = util.toSetString(source);
    return Object.prototype.hasOwnProperty.call(this._sourcesContents, key) ? this._sourcesContents[key] : null;
  }, this);
}, "SourceMapGenerator_generateSourcesContent");
SourceMapGenerator$1.prototype.toJSON = /* @__PURE__ */ __name(function SourceMapGenerator_toJSON() {
  var map = {
    version: this._version,
    sources: this._sources.toArray(),
    names: this._names.toArray(),
    mappings: this._serializeMappings()
  };
  if (this._file != null) {
    map.file = this._file;
  }
  if (this._sourceRoot != null) {
    map.sourceRoot = this._sourceRoot;
  }
  if (this._sourcesContents) {
    map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
  }
  return map;
}, "SourceMapGenerator_toJSON");
SourceMapGenerator$1.prototype.toString = /* @__PURE__ */ __name(function SourceMapGenerator_toString() {
  return JSON.stringify(this.toJSON());
}, "SourceMapGenerator_toString");
sourceMapGenerator.SourceMapGenerator = SourceMapGenerator$1;
var SourceMapGenerator = sourceMapGenerator.SourceMapGenerator;
var St = Object.defineProperty;
var $t = /* @__PURE__ */ __name((e, r) => {
  for (var t in r) St(e, t, { get: r[t], enumerable: true });
}, "$t");
var pe = {};
$t(pe, { DEBUG: /* @__PURE__ */ __name(() => fe, "DEBUG") });
var fe = Tt(process.env.DEBUG);
function Tt(e) {
  if (typeof e == "boolean") return e;
  if (e === void 0) return false;
  if (e === "true" || e === "1") return true;
  if (e === "false" || e === "0") return false;
  if (e === "*") return true;
  let r = e.split(",").map((t) => t.split(":")[0]);
  return r.includes("-tailwindcss") ? false : !!r.includes("tailwindcss");
}
__name(Tt, "Tt");
var Et = [/import[\s\S]*?['"](.{3,}?)['"]/gi, /import[\s\S]*from[\s\S]*?['"](.{3,}?)['"]/gi, /export[\s\S]*from[\s\S]*?['"](.{3,}?)['"]/gi, /require\(['"`](.+)['"`]\)/gi], Nt = [".js", ".cjs", ".mjs"], Vt = ["", ".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".jsx", ".tsx"], Rt = ["", ".ts", ".cts", ".mts", ".tsx", ".js", ".cjs", ".mjs", ".jsx"];
async function Ot(e, r) {
  var _a2;
  for (let t of r) {
    let i2 = `${e}${t}`;
    if ((_a2 = await de.stat(i2).catch(() => null)) == null ? void 0 : _a2.isFile()) return i2;
  }
  for (let t of r) {
    let i2 = `${e}/index${t}`;
    if (await de.access(i2).then(() => true, () => false)) return i2;
  }
  return null;
}
__name(Ot, "Ot");
async function Oe(e, r, t, i2) {
  let o = Nt.includes(i2) ? Vt : Rt, a2 = await Ot(path9__default.resolve(t, r), o);
  if (a2 === null || e.has(a2)) return;
  e.add(a2), t = path9__default.dirname(a2), i2 = path9__default.extname(a2);
  let n2 = await de.readFile(a2, "utf-8"), s = [];
  for (let l2 of Et) for (let u2 of n2.matchAll(l2)) u2[1].startsWith(".") && s.push(Oe(e, u2[1], t, i2));
  await Promise.all(s);
}
__name(Oe, "Oe");
async function Pe(e) {
  let r = /* @__PURE__ */ new Set();
  return await Oe(r, e, path9__default.dirname(e), path9__default.extname(e)), Array.from(r);
}
__name(Pe, "Pe");
function M$1(e) {
  return { kind: "word", value: e };
}
__name(M$1, "M$1");
function Pt(e, r) {
  return { kind: "function", value: e, nodes: r };
}
__name(Pt, "Pt");
function _t(e) {
  return { kind: "separator", value: e };
}
__name(_t, "_t");
function S(e) {
  let r = "";
  for (let t of e) switch (t.kind) {
    case "word":
    case "separator": {
      r += t.value;
      break;
    }
    case "function":
      r += t.value + "(" + S(t.nodes) + ")";
  }
  return r;
}
__name(S, "S");
var _e = 92, It = 41, Ie = 58, De = 44, Dt = 34, Ue = 61, Le = 62, Ke = 60, ze = 10, Ut = 40, Lt = 39, Kt = 47, Me = 32, Fe = 9;
function A(e) {
  e = e.replaceAll(`\r
`, `
`);
  let r = [], t = [], i2 = null, o = "", a2;
  for (let n2 = 0; n2 < e.length; n2++) {
    let s = e.charCodeAt(n2);
    switch (s) {
      case _e: {
        o += e[n2] + e[n2 + 1], n2++;
        break;
      }
      case Kt: {
        if (o.length > 0) {
          let u2 = M$1(o);
          i2 ? i2.nodes.push(u2) : r.push(u2), o = "";
        }
        let l2 = M$1(e[n2]);
        i2 ? i2.nodes.push(l2) : r.push(l2);
        break;
      }
      case Ie:
      case De:
      case Ue:
      case Le:
      case Ke:
      case ze:
      case Me:
      case Fe: {
        if (o.length > 0) {
          let f2 = M$1(o);
          i2 ? i2.nodes.push(f2) : r.push(f2), o = "";
        }
        let l2 = n2, u2 = n2 + 1;
        for (; u2 < e.length && (a2 = e.charCodeAt(u2), !(a2 !== Ie && a2 !== De && a2 !== Ue && a2 !== Le && a2 !== Ke && a2 !== ze && a2 !== Me && a2 !== Fe)); u2++) ;
        n2 = u2 - 1;
        let p = _t(e.slice(l2, u2));
        i2 ? i2.nodes.push(p) : r.push(p);
        break;
      }
      case Lt:
      case Dt: {
        let l2 = n2;
        for (let u2 = n2 + 1; u2 < e.length; u2++) if (a2 = e.charCodeAt(u2), a2 === _e) u2 += 1;
        else if (a2 === s) {
          n2 = u2;
          break;
        }
        o += e.slice(l2, n2 + 1);
        break;
      }
      case Ut: {
        let l2 = Pt(o, []);
        o = "", i2 ? i2.nodes.push(l2) : r.push(l2), t.push(l2), i2 = l2;
        break;
      }
      case It: {
        let l2 = t.pop();
        if (o.length > 0) {
          let u2 = M$1(o);
          l2 == null ? void 0 : l2.nodes.push(u2), o = "";
        }
        t.length > 0 ? i2 = t[t.length - 1] : i2 = null;
        break;
      }
      default:
        o += String.fromCharCode(s);
    }
  }
  return o.length > 0 && r.push(M$1(o)), r;
}
__name(A, "A");
var g = (_g = class extends Map {
  constructor(t) {
    super();
    this.factory = t;
  }
  get(t) {
    let i2 = super.get(t);
    return i2 === void 0 && (i2 = this.factory(t, this), this.set(t, i2)), i2;
  }
}, __name(_g, "g"), _g);
var te = new Uint8Array(256);
function y(e, r) {
  let t = 0, i2 = [], o = 0, a2 = e.length, n2 = r.charCodeAt(0);
  for (let s = 0; s < a2; s++) {
    let l2 = e.charCodeAt(s);
    if (t === 0 && l2 === n2) {
      i2.push(e.slice(o, s)), o = s + 1;
      continue;
    }
    switch (l2) {
      case 92:
        s += 1;
        break;
      case 39:
      case 34:
        for (; ++s < a2; ) {
          let u2 = e.charCodeAt(s);
          if (u2 === 92) {
            s += 1;
            continue;
          }
          if (u2 === l2) break;
        }
        break;
      case 40:
        te[t] = 41, t++;
        break;
      case 91:
        te[t] = 93, t++;
        break;
      case 123:
        te[t] = 125, t++;
        break;
      case 93:
      case 125:
      case 41:
        t > 0 && l2 === te[t - 1] && t--;
        break;
    }
  }
  return i2.push(e.slice(o)), i2;
}
__name(y, "y");
var me = ((n2) => (n2[n2.Continue = 0] = "Continue", n2[n2.Skip = 1] = "Skip", n2[n2.Stop = 2] = "Stop", n2[n2.Replace = 3] = "Replace", n2[n2.ReplaceSkip = 4] = "ReplaceSkip", n2[n2.ReplaceStop = 5] = "ReplaceStop", n2))(me || {}), w$1 = { Continue: { kind: 0 }, Skip: { kind: 1 }, Stop: { kind: 2 }, Replace: /* @__PURE__ */ __name((e) => ({ kind: 3, nodes: Array.isArray(e) ? e : [e] }), "Replace"), ReplaceSkip: /* @__PURE__ */ __name((e) => ({ kind: 4, nodes: Array.isArray(e) ? e : [e] }), "ReplaceSkip"), ReplaceStop: /* @__PURE__ */ __name((e) => ({ kind: 5, nodes: Array.isArray(e) ? e : [e] }), "ReplaceStop") };
function v(e, r) {
  typeof r == "function" ? je(e, r) : je(e, r.enter, r.exit);
}
__name(v, "v");
function je(e, r = () => w$1.Continue, t = () => w$1.Continue) {
  let i2 = [[e, 0, null]], o = { parent: null, depth: 0, path() {
    let a2 = [];
    for (let n2 = 1; n2 < i2.length; n2++) {
      let s = i2[n2][2];
      s && a2.push(s);
    }
    return a2;
  } };
  for (; i2.length > 0; ) {
    let a2 = i2.length - 1, n2 = i2[a2], s = n2[0], l2 = n2[1], u2 = n2[2];
    if (l2 >= s.length) {
      i2.pop();
      continue;
    }
    if (o.parent = u2, o.depth = a2, l2 >= 0) {
      let m = s[l2], d2 = r(m, o) ?? w$1.Continue;
      switch (d2.kind) {
        case 0: {
          m.nodes && m.nodes.length > 0 && i2.push([m.nodes, 0, m]), n2[1] = ~l2;
          continue;
        }
        case 2:
          return;
        case 1: {
          n2[1] = ~l2;
          continue;
        }
        case 3: {
          s.splice(l2, 1, ...d2.nodes);
          continue;
        }
        case 5: {
          s.splice(l2, 1, ...d2.nodes);
          return;
        }
        case 4: {
          s.splice(l2, 1, ...d2.nodes), n2[1] += d2.nodes.length;
          continue;
        }
        default:
          throw new Error(`Invalid \`WalkAction.${me[d2.kind] ?? `Unknown(${d2.kind})`}\` in enter.`);
      }
    }
    let p = ~l2, f2 = s[p], c2 = t(f2, o) ?? w$1.Continue;
    switch (c2.kind) {
      case 0:
        n2[1] = p + 1;
        continue;
      case 2:
        return;
      case 3: {
        s.splice(p, 1, ...c2.nodes), n2[1] = p + c2.nodes.length;
        continue;
      }
      case 5: {
        s.splice(p, 1, ...c2.nodes);
        return;
      }
      case 4: {
        s.splice(p, 1, ...c2.nodes), n2[1] = p + c2.nodes.length;
        continue;
      }
      default:
        throw new Error(`Invalid \`WalkAction.${me[c2.kind] ?? `Unknown(${c2.kind})`}\` in exit.`);
    }
  }
}
__name(je, "je");
new g((e) => {
  let r = A(e), t = /* @__PURE__ */ new Set();
  return v(r, (i2, o) => {
    let a2 = o.parent === null ? r : o.parent.nodes ?? [];
    if (i2.kind === "word" && (i2.value === "+" || i2.value === "-" || i2.value === "*" || i2.value === "/")) {
      let n2 = a2.indexOf(i2) ?? -1;
      if (n2 === -1) return;
      let s = a2[n2 - 1];
      if ((s == null ? void 0 : s.kind) !== "separator" || s.value !== " ") return;
      let l2 = a2[n2 + 1];
      if ((l2 == null ? void 0 : l2.kind) !== "separator" || l2.value !== " ") return;
      t.add(s), t.add(l2);
    } else i2.kind === "separator" && i2.value.length > 0 && i2.value.trim() === "" ? (a2[0] === i2 || a2[a2.length - 1] === i2) && t.add(i2) : i2.kind === "separator" && i2.value.trim() === "," && (i2.value = ",");
  }), t.size > 0 && v(r, (i2) => {
    if (t.has(i2)) return t.delete(i2), w$1.ReplaceSkip([]);
  }), ge(r), S(r);
});
new g((e) => {
  let r = A(e);
  return r.length === 3 && r[0].kind === "word" && r[0].value === "&" && r[1].kind === "separator" && r[1].value === ":" && r[2].kind === "function" && r[2].value === "is" ? S(r[2].nodes) : e;
});
function ge(e) {
  for (let r of e) switch (r.kind) {
    case "function": {
      if (r.value === "url" || r.value.endsWith("_url")) {
        r.value = W(r.value);
        break;
      }
      if (r.value === "var" || r.value.endsWith("_var") || r.value === "theme" || r.value.endsWith("_theme")) {
        r.value = W(r.value);
        for (let t = 0; t < r.nodes.length; t++) ge([r.nodes[t]]);
        break;
      }
      r.value = W(r.value), ge(r.nodes);
      break;
    }
    case "separator":
      r.value = W(r.value);
      break;
    case "word": {
      (r.value[0] !== "-" || r.value[1] !== "-") && (r.value = W(r.value));
      break;
    }
    default:
      zt(r);
  }
}
__name(ge, "ge");
new g((e) => {
  let r = A(e);
  return r.length === 1 && r[0].kind === "function" && r[0].value === "var";
});
function zt(e) {
  throw new Error(`Unexpected value: ${e}`);
}
__name(zt, "zt");
function W(e) {
  return e.replaceAll("_", String.raw`\_`).replaceAll(" ", "_");
}
__name(W, "W");
process.env.FEATURES_ENV !== "stable";
function B$1(e, r) {
  if (r === null) return e;
  let t = Number(r);
  return Number.isNaN(t) || (r = `${t * 100}%`), r === "100%" ? e : `color-mix(in oklab, ${e} ${r}, transparent)`;
}
__name(B$1, "B$1");
var Yt = { "--alpha": Gt, "--spacing": Ht, "--theme": qt, theme: Zt };
function Gt(e, r, t, ...i2) {
  let [o, a2] = y(t, "/").map((n2) => n2.trim());
  if (!o || !a2) throw new Error(`The --alpha(…) function requires a color and an alpha value, e.g.: \`--alpha(${o || "var(--my-color)"} / ${a2 || "50%"})\``);
  if (i2.length > 0) throw new Error(`The --alpha(…) function only accepts one argument, e.g.: \`--alpha(${o || "var(--my-color)"} / ${a2 || "50%"})\``);
  return B$1(o, a2);
}
__name(Gt, "Gt");
function Ht(e, r, t, ...i2) {
  if (!t) throw new Error("The --spacing(…) function requires an argument, but received none.");
  if (i2.length > 0) throw new Error(`The --spacing(…) function only accepts a single argument, but received ${i2.length + 1}.`);
  let o = e.theme.resolve(null, ["--spacing"]);
  if (!o) throw new Error("The --spacing(…) function requires that the `--spacing` theme variable exists, but it was not found.");
  return `calc(${o} * ${t})`;
}
__name(Ht, "Ht");
function qt(e, r, t, ...i2) {
  if (!t.startsWith("--")) throw new Error("The --theme(…) function can only be used with CSS variables from your theme.");
  let o = false;
  t.endsWith(" inline") && (o = true, t = t.slice(0, -7)), r.kind === "at-rule" && (o = true);
  let a2 = e.resolveThemeValue(t, o);
  if (!a2) {
    if (i2.length > 0) return i2.join(", ");
    throw new Error(`Could not resolve value for theme function: \`theme(${t})\`. Consider checking if the variable name is correct or provide a fallback value to silence this error.`);
  }
  if (i2.length === 0) return a2;
  let n2 = i2.join(", ");
  if (n2 === "initial") return a2;
  if (a2 === "initial") return n2;
  if (a2.startsWith("var(") || a2.startsWith("theme(") || a2.startsWith("--theme(")) {
    let s = A(a2);
    return Jt(s, n2), S(s);
  }
  return a2;
}
__name(qt, "qt");
function Zt(e, r, t, ...i2) {
  t = Qt(t);
  let o = e.resolveThemeValue(t);
  if (!o && i2.length > 0) return i2.join(", ");
  if (!o) throw new Error(`Could not resolve value for theme function: \`theme(${t})\`. Consider checking if the path is correct or provide a fallback value to silence this error.`);
  return o;
}
__name(Zt, "Zt");
new RegExp(Object.keys(Yt).map((e) => `${e}\\(`).join("|"));
function Qt(e) {
  if (e[0] !== "'" && e[0] !== '"') return e;
  let r = "", t = e[0];
  for (let i2 = 1; i2 < e.length - 1; i2++) {
    let o = e[i2], a2 = e[i2 + 1];
    o === "\\" && (a2 === t || a2 === "\\") ? (r += a2, i2++) : r += o;
  }
  return r;
}
__name(Qt, "Qt");
function Jt(e, r) {
  v(e, (t) => {
    if (t.kind === "function" && !(t.value !== "var" && t.value !== "theme" && t.value !== "--theme")) if (t.nodes.length === 1) t.nodes.push({ kind: "word", value: `, ${r}` });
    else {
      let i2 = t.nodes[t.nodes.length - 1];
      i2.kind === "word" && i2.value === "initial" && (i2.value = r);
    }
  });
}
__name(Jt, "Jt");
var er = /^(?<value>[-+]?(?:\d*\.)?\d+)(?<unit>[a-z]+|%)?$/i;
new g((e) => {
  var _a2, _b2;
  let r = er.exec(e);
  if (!r) return null;
  let t = (_a2 = r.groups) == null ? void 0 : _a2.value;
  if (t === void 0) return null;
  let i2 = Number(t);
  if (Number.isNaN(i2)) return null;
  let o = (_b2 = r.groups) == null ? void 0 : _b2.unit;
  return o === void 0 ? [i2, null] : [i2, o];
});
function we(e) {
  let r = [0];
  for (let o = 0; o < e.length; o++) e.charCodeAt(o) === 10 && r.push(o + 1);
  function t(o) {
    let a2 = 0, n2 = r.length;
    for (; n2 > 0; ) {
      let l2 = (n2 | 0) >> 1, u2 = a2 + l2;
      r[u2] <= o ? (a2 = u2 + 1, n2 = n2 - l2 - 1) : n2 = l2;
    }
    a2 -= 1;
    let s = o - r[a2];
    return { line: a2 + 1, column: s };
  }
  __name(t, "t");
  function i2({ line: o, column: a2 }) {
    o -= 1, o = Math.min(Math.max(o, 0), r.length - 1);
    let n2 = r[o], s = r[o + 1] ?? n2;
    return Math.min(Math.max(n2 + a2, 0), s);
  }
  __name(i2, "i");
  return { find: t, findOffset: i2 };
}
__name(we, "we");
var H = 92, ie = 47, ne = 42, et = 34, tt = 39, pr = 58, oe = 59, T = 10, ae = 13, q$2 = 32, Z = 9, rt = 123, ye = 125, xe = 40, it = 41, dr = 91, mr = 93, nt = 45, ke = 64, gr = 33, E$1 = (_h = class extends Error {
  constructor(r, t) {
    if (t) {
      let i2 = t[0], o = we(i2.code).find(t[1]);
      r = `${i2.file}:${o.line}:${o.column + 1}: ${r}`;
    }
    super(r);
    __publicField(this, "loc");
    this.name = "CssSyntaxError", this.loc = t, Error.captureStackTrace && Error.captureStackTrace(this, _h);
  }
}, __name(_h, "e"), _h);
function J(e, r) {
  let t = null;
  e[0] === "\uFEFF" && (e = " " + e.slice(1));
  let i2 = [], o = [], a2 = [], n2 = null, s = null, l2 = "", u2 = "", f2;
  for (let c2 = 0; c2 < e.length; c2++) {
    let m = e.charCodeAt(c2);
    if (!(m === ae && (f2 = e.charCodeAt(c2 + 1), f2 === T))) if (m === H) l2 += e.slice(c2, c2 + 2), c2 += 1;
    else if (m === ie && e.charCodeAt(c2 + 1) === ne) {
      let d2 = c2;
      for (let h2 = c2 + 2; h2 < e.length; h2++) if (f2 = e.charCodeAt(h2), f2 === H) h2 += 1;
      else if (f2 === ne && e.charCodeAt(h2 + 1) === ie) {
        c2 = h2 + 1;
        break;
      }
      let x2 = e.slice(d2, c2 + 1);
      if (x2.charCodeAt(2) === gr) {
        let h2 = Ce(x2.slice(2, -2));
        o.push(h2);
      }
    } else if (m === tt || m === et) {
      let d2 = ot(e, c2, m, t);
      l2 += e.slice(c2, d2 + 1), c2 = d2;
    } else {
      if ((m === q$2 || m === T || m === Z) && (f2 = e.charCodeAt(c2 + 1)) && (f2 === q$2 || f2 === T || f2 === Z || f2 === ae && (f2 = e.charCodeAt(c2 + 2)) && f2 == T)) continue;
      if (m === T) {
        if (l2.length === 0) continue;
        f2 = l2.charCodeAt(l2.length - 1), f2 !== q$2 && f2 !== T && f2 !== Z && (l2 += " ");
      } else if (m === nt && e.charCodeAt(c2 + 1) === nt && l2.length === 0) {
        let d2 = "", x2 = c2, h2 = -1;
        for (let k2 = c2 + 2; k2 < e.length; k2++) if (f2 = e.charCodeAt(k2), f2 === H) k2 += 1;
        else if (f2 === tt || f2 === et) k2 = ot(e, k2, f2, t);
        else if (f2 === ie && e.charCodeAt(k2 + 1) === ne) {
          for (let z2 = k2 + 2; z2 < e.length; z2++) if (f2 = e.charCodeAt(z2), f2 === H) z2 += 1;
          else if (f2 === ne && e.charCodeAt(z2 + 1) === ie) {
            k2 = z2 + 1;
            break;
          }
        } else if (h2 === -1 && f2 === pr) h2 = l2.length + k2 - x2;
        else if (f2 === oe && d2.length === 0) {
          l2 += e.slice(x2, k2), c2 = k2;
          break;
        } else if (f2 === xe) d2 += ")";
        else if (f2 === dr) d2 += "]";
        else if (f2 === rt) d2 += "}";
        else if ((f2 === ye || e.length - 1 === k2) && d2.length === 0) {
          c2 = k2 - 1, l2 += e.slice(x2, k2);
          break;
        } else (f2 === it || f2 === mr || f2 === ye) && d2.length > 0 && e[k2] === d2[d2.length - 1] && (d2 = d2.slice(0, -1));
        let I = be(l2, h2);
        if (!I) throw new E$1("Invalid custom property, expected a value", null);
        n2 ? n2.nodes.push(I) : i2.push(I), l2 = "";
      } else if (m === oe && l2.charCodeAt(0) === ke) s = Q(l2), n2 ? n2.nodes.push(s) : i2.push(s), l2 = "", s = null;
      else if (m === oe && u2[u2.length - 1] !== ")") {
        let d2 = be(l2);
        if (!d2) {
          if (l2.length === 0) continue;
          throw new E$1(`Invalid declaration: \`${l2.trim()}\``, null);
        }
        n2 ? n2.nodes.push(d2) : i2.push(d2), l2 = "";
      } else if (m === rt && u2[u2.length - 1] !== ")") u2 += "}", s = P$1(l2.trim()), n2 && n2.nodes.push(s), a2.push(n2), n2 = s, l2 = "", s = null;
      else if (m === ye && u2[u2.length - 1] !== ")") {
        if (u2 === "") throw new E$1("Missing opening {", null);
        if (u2 = u2.slice(0, -1), l2.length > 0) if (l2.charCodeAt(0) === ke) s = Q(l2), n2 ? n2.nodes.push(s) : i2.push(s), l2 = "", s = null;
        else {
          let x2 = l2.indexOf(":");
          if (n2) {
            let h2 = be(l2, x2);
            if (!h2) throw new E$1(`Invalid declaration: \`${l2.trim()}\``, null);
            n2.nodes.push(h2);
          }
        }
        let d2 = a2.pop() ?? null;
        d2 === null && n2 && i2.push(n2), n2 = d2, l2 = "", s = null;
      } else if (m === xe) u2 += ")", l2 += "(";
      else if (m === it) {
        if (u2[u2.length - 1] !== ")") throw new E$1("Missing opening (", null);
        u2 = u2.slice(0, -1), l2 += ")";
      } else {
        if (l2.length === 0 && (m === q$2 || m === T || m === Z)) continue;
        l2 += String.fromCharCode(m);
      }
    }
  }
  if (l2.charCodeAt(0) === ke) {
    let c2 = Q(l2);
    i2.push(c2);
  }
  if (u2.length > 0 && n2) {
    if (n2.kind === "rule") throw new E$1(`Missing closing } at ${n2.selector}`, n2.src ? [n2.src[0], n2.src[1], n2.src[1]] : null);
    if (n2.kind === "at-rule") throw new E$1(`Missing closing } at ${n2.name} ${n2.params}`, n2.src ? [n2.src[0], n2.src[1], n2.src[1]] : null);
  }
  return o.length > 0 ? o.concat(i2) : i2;
}
__name(J, "J");
function Q(e, r = []) {
  let t = e, i2 = "";
  for (let o = 5; o < e.length; o++) {
    let a2 = e.charCodeAt(o);
    if (a2 === q$2 || a2 === Z || a2 === xe) {
      t = e.slice(0, o), i2 = e.slice(o);
      break;
    }
  }
  return $(t.trim(), i2.trim(), r);
}
__name(Q, "Q");
function be(e, r = e.indexOf(":")) {
  if (r === -1) return null;
  let t = e.indexOf("!important", r + 1);
  return V$1(e.slice(0, r).trim(), e.slice(r + 1, t === -1 ? e.length : t).trim(), t !== -1);
}
__name(be, "be");
function ot(e, r, t, i2 = null) {
  let o;
  for (let a2 = r + 1; a2 < e.length; a2++) if (o = e.charCodeAt(a2), o === H) a2 += 1;
  else {
    if (o === t) return a2;
    if (o === oe && (e.charCodeAt(a2 + 1) === T || e.charCodeAt(a2 + 1) === ae && e.charCodeAt(a2 + 2) === T)) throw new E$1(`Unterminated string: ${e.slice(r, a2 + 1) + String.fromCharCode(t)}`, i2 ? [i2, r, a2 + 1] : null);
    if (o === T || o === ae && e.charCodeAt(a2 + 1) === T) throw new E$1(`Unterminated string: ${e.slice(r, a2) + String.fromCharCode(t)}`, i2 ? [i2, r, a2 + 1] : null);
  }
  return r;
}
__name(ot, "ot");
var Ar = 64;
function D(e, r = []) {
  return { kind: "rule", selector: e, nodes: r };
}
__name(D, "D");
function $(e, r = "", t = []) {
  return { kind: "at-rule", name: e, params: r, nodes: t };
}
__name($, "$");
function P$1(e, r = []) {
  return e.charCodeAt(0) === Ar ? Q(e, r) : D(e, r);
}
__name(P$1, "P$1");
function V$1(e, r, t = false) {
  return { kind: "declaration", property: e, value: r, important: t };
}
__name(V$1, "V$1");
function Ce(e) {
  return { kind: "comment", value: e };
}
__name(Ce, "Ce");
function L(e, r) {
  function o(n2, s = 0) {
    let l2 = "", u2 = "  ".repeat(s);
    if (n2.kind === "declaration") {
      if (l2 += `${u2}${n2.property}: ${n2.value}${n2.important ? " !important" : ""};
`, r) ;
    } else if (n2.kind === "rule") {
      if (l2 += `${u2}${n2.selector} {
`, r) ;
      for (let p of n2.nodes) l2 += o(p, s + 1);
      l2 += `${u2}}
`;
    } else if (n2.kind === "at-rule") {
      if (n2.nodes.length === 0) {
        let p = `${u2}${n2.name} ${n2.params};
`;
        return p;
      }
      if (l2 += `${u2}${n2.name}${n2.params ? ` ${n2.params} ` : " "}{
`, r) ;
      for (let p of n2.nodes) l2 += o(p, s + 1);
      l2 += `${u2}}
`;
    } else if (n2.kind === "comment") {
      if (l2 += `${u2}/*${n2.value}*/
`, r) ;
    } else if (n2.kind === "context" || n2.kind === "at-root") return "";
    return l2;
  }
  __name(o, "o");
  let a2 = "";
  for (let n2 of e) a2 += o(n2, 0);
  return a2;
}
__name(L, "L");
function Cr(e, r) {
  if (typeof e != "string") throw new TypeError("expected path to be a string");
  if (e === "\\" || e === "/") return "/";
  var t = e.length;
  if (t <= 1) return e;
  var i2 = "";
  if (t > 4 && e[3] === "\\") {
    var o = e[2];
    (o === "?" || o === ".") && e.slice(0, 2) === "\\\\" && (e = e.slice(2), i2 = "//");
  }
  var a2 = e.split(/[/\\]+/);
  return a2[a2.length - 1] === "" && a2.pop(), i2 + a2.join("/");
}
__name(Cr, "Cr");
function $e(e) {
  let r = Cr(e);
  return e.startsWith("\\\\") && r.startsWith("/") && !r.startsWith("//") ? `/${r}` : r;
}
__name($e, "$e");
var Ee = new RegExp(`(?<!@import\\s+)(?<=^|[^\\w\\-\\u0080-\\uffff])url\\((\\s*('[^']+'|"[^"]+")\\s*|[^'")]+)\\)`), ut = new RegExp("(?<=image-set\\()((?:[\\w-]{1,256}\\([^)]*\\)|[^)])*)(?=\\))"), Sr = /(?:gradient|element|cross-fade|image)\(/, $r = /^\s*data:/i, Tr = /^([a-z]+:)?\/\//, Er = /^[A-Z_][.\w-]*\(/i, Nr = /(?:^|\s)(?<url>[\w-]+\([^)]*\)|"[^"]*"|'[^']*'|[^,]\S*[^,])\s*(?:\s(?<descriptor>\w[^,]+))?(?:,|$)/g, Vr = new RegExp('(?<!\\\\)"', "g"), Rr = /(?: |\\t|\\n|\\f|\\r)+/g, Or = /* @__PURE__ */ __name((e) => $r.test(e), "Or"), Pr = /* @__PURE__ */ __name((e) => Tr.test(e), "Pr");
async function ct({ css: e, base: r, root: t }) {
  if (!e.includes("url(") && !e.includes("image-set(")) return e;
  let i2 = J(e), o = [];
  function a2(n2) {
    if (n2[0] === "/") return n2;
    let s = path9.posix.join($e(r), n2), l2 = path9.posix.relative($e(t), s);
    return l2.startsWith(".") || (l2 = "./" + l2), l2;
  }
  __name(a2, "a");
  return v(i2, (n2) => {
    if (n2.kind !== "declaration" || !n2.value) return;
    let s = Ee.test(n2.value), l2 = ut.test(n2.value);
    if (s || l2) {
      let u2 = l2 ? _r : ft;
      o.push(u2(n2.value, a2).then((p) => {
        n2.value = p;
      }));
    }
  }), o.length && await Promise.all(o), L(i2);
}
__name(ct, "ct");
function ft(e, r) {
  return dt(e, Ee, async (t) => {
    let [i2, o] = t;
    return await pt(o.trim(), i2, r);
  });
}
__name(ft, "ft");
async function _r(e, r) {
  return await dt(e, ut, async (t) => {
    let [, i2] = t;
    return await Dr(i2, async ({ url: a2 }) => Ee.test(a2) ? await ft(a2, r) : Sr.test(a2) ? a2 : await pt(a2, a2, r));
  });
}
__name(_r, "_r");
async function pt(e, r, t, i2 = "url") {
  let o = "", a2 = e[0];
  if ((a2 === '"' || a2 === "'") && (o = a2, e = e.slice(1, -1)), Ir(e)) return r;
  let n2 = await t(e);
  return o === "" && n2 !== encodeURI(n2) && (o = '"'), o === "'" && n2.includes("'") && (o = '"'), o === '"' && n2.includes('"') && (n2 = n2.replace(Vr, '\\"')), `${i2}(${o}${n2}${o})`;
}
__name(pt, "pt");
function Ir(e, r) {
  return Pr(e) || Or(e) || !e[0].match(/[\.a-zA-Z0-9_]/) || Er.test(e);
}
__name(Ir, "Ir");
function Dr(e, r) {
  return Promise.all(Ur(e).map(async ({ url: t, descriptor: i2 }) => ({ url: await r({ url: t, descriptor: i2 }), descriptor: i2 }))).then(Lr);
}
__name(Dr, "Dr");
function Ur(e) {
  let r = e.trim().replace(Rr, " ").replace(/\r?\n/, "").replace(/,\s+/, ", ").replaceAll(/\s+/g, " ").matchAll(Nr);
  return Array.from(r, ({ groups: t }) => {
    var _a2, _b2;
    return { url: ((_a2 = t == null ? void 0 : t.url) == null ? void 0 : _a2.trim()) ?? "", descriptor: ((_b2 = t == null ? void 0 : t.descriptor) == null ? void 0 : _b2.trim()) ?? "" };
  }).filter(({ url: t }) => !!t);
}
__name(Ur, "Ur");
function Lr(e) {
  return e.map(({ url: r, descriptor: t }) => r + (t ? ` ${t}` : "")).join(", ");
}
__name(Lr, "Lr");
async function dt(e, r, t) {
  let i2, o = e, a2 = "";
  for (; i2 = r.exec(o); ) a2 += o.slice(0, i2.index), a2 += await t(i2), o = o.slice(i2.index + i2[0].length);
  return a2 += o, a2;
}
__name(dt, "dt");
function yt({ base: e, from: r, polyfills: t, onDependency: i2, shouldRewriteUrls: o, customCssResolver: a2, customJsResolver: n2 }) {
  return { base: e, polyfills: t, from: r, async loadModule(s, l2) {
    return bt(s, l2, i2, n2);
  }, async loadStylesheet(s, l2) {
    let u2 = await xt(s, l2, i2, a2);
    return u2.content = await ct({ css: u2.content, root: e, base: u2.base }), u2;
  } };
}
__name(yt, "yt");
async function kt(e) {
  if (e.root && e.root !== "none") {
    let r = /[*{]/, t = [];
    for (let o of e.root.pattern.split("/")) {
      if (r.test(o)) break;
      t.push(o);
    }
    if (!await de.stat(path9__default.resolve(e.root.base, t.join("/"))).then((o) => o.isDirectory()).catch(() => false)) throw new Error(`The \`source(${e.root.pattern})\` does not exist or is not a directory.`);
  }
}
__name(kt, "kt");
async function lu(e, r) {
  let t = await compile(e, yt(r));
  return await kt(t), t;
}
__name(lu, "lu");
async function bt(e, r, t, i2) {
  if (e[0] !== ".") {
    let s = await vt(e, r, i2);
    if (!s) throw new Error(`Could not resolve '${e}' from '${r}'`);
    let l2 = await ht(pathToFileURL(s).href);
    return { path: s, base: path9__default.dirname(s), module: l2.default ?? l2 };
  }
  let o = await vt(e, r, i2);
  if (!o) throw new Error(`Could not resolve '${e}' from '${r}'`);
  let [a2, n2] = await Promise.all([ht(pathToFileURL(o).href + "?id=" + Date.now()), Pe(o)]);
  for (let s of n2) t(s);
  return { path: o, base: path9__default.dirname(o), module: a2.default ?? a2 };
}
__name(bt, "bt");
async function xt(e, r, t, i2) {
  let o = await Wr(e, r, i2);
  if (!o) throw new Error(`Could not resolve '${e}' from '${r}'`);
  t(o);
  let a2 = await de.readFile(o, "utf-8");
  return { path: o, base: path9__default.dirname(o), content: a2 };
}
__name(xt, "xt");
var gt = null;
async function ht(e) {
  if (typeof globalThis.__tw_load == "function") {
    let r = await globalThis.__tw_load(e);
    if (r) return r;
  }
  try {
    return await import(e);
  } catch {
    return gt ?? (gt = createJiti(import.meta.url, { moduleCache: false, fsCache: false })), await gt.import(e);
  }
}
__name(ht, "ht");
var Re = ["node_modules", ...process.env.NODE_PATH ? [process.env.NODE_PATH] : []], jr = F$1.ResolverFactory.createResolver({ fileSystem: new F$1.CachedInputFileSystem(fs5__default, 4e3), useSyncFileSystemCalls: true, extensions: [".css"], mainFields: ["style"], conditionNames: ["style"], modules: Re });
async function Wr(e, r, t) {
  if (typeof globalThis.__tw_resolve == "function") {
    let i2 = globalThis.__tw_resolve(e, r);
    if (i2) return Promise.resolve(i2);
  }
  if (t) {
    let i2 = await t(e, r);
    if (i2) return i2;
  }
  return Ne(jr, e, r);
}
__name(Wr, "Wr");
var Br = F$1.ResolverFactory.createResolver({ fileSystem: new F$1.CachedInputFileSystem(fs5__default, 4e3), useSyncFileSystemCalls: true, extensions: [".js", ".json", ".node", ".ts"], conditionNames: ["node", "import"], modules: Re }), Yr = F$1.ResolverFactory.createResolver({ fileSystem: new F$1.CachedInputFileSystem(fs5__default, 4e3), useSyncFileSystemCalls: true, extensions: [".js", ".json", ".node", ".ts"], conditionNames: ["node", "require"], modules: Re });
async function vt(e, r, t) {
  if (typeof globalThis.__tw_resolve == "function") {
    let i2 = globalThis.__tw_resolve(e, r);
    if (i2) return Promise.resolve(i2);
  }
  if (t) {
    let i2 = await t(e, r);
    if (i2) return i2;
  }
  return Ne(Br, e, r).catch(() => Ne(Yr, e, r));
}
__name(vt, "vt");
function Ne(e, r, t) {
  return new Promise((i2, o) => e.resolve({}, t, r, {}, (a2, n2) => {
    if (a2) return o(a2);
    i2(n2);
  }));
}
__name(Ne, "Ne");
Symbol.dispose ?? (Symbol.dispose = Symbol("Symbol.dispose"));
Symbol.asyncDispose ?? (Symbol.asyncDispose = Symbol("Symbol.asyncDispose"));
var At = (_i = class {
  constructor(r = (t) => void process.stderr.write(`${t}
`)) {
    __privateAdd(this, _r2, new g(() => ({ value: 0 })));
    __privateAdd(this, _t2, new g(() => ({ value: 0n })));
    __privateAdd(this, _e3, []);
    this.defaultFlush = r;
  }
  hit(r) {
    __privateGet(this, _r2).get(r).value++;
  }
  start(r) {
    let t = __privateGet(this, _e3).map((o) => o.label).join("//"), i2 = `${t}${t.length === 0 ? "" : "//"}${r}`;
    __privateGet(this, _r2).get(i2).value++, __privateGet(this, _t2).get(i2), __privateGet(this, _e3).push({ id: i2, label: r, namespace: t, value: process.hrtime.bigint() });
  }
  end(r) {
    let t = process.hrtime.bigint();
    if (__privateGet(this, _e3)[__privateGet(this, _e3).length - 1].label !== r) throw new Error(`Mismatched timer label: \`${r}\`, expected \`${__privateGet(this, _e3)[__privateGet(this, _e3).length - 1].label}\``);
    let i2 = __privateGet(this, _e3).pop(), o = t - i2.value;
    __privateGet(this, _t2).get(i2.id).value += o;
  }
  reset() {
    __privateGet(this, _r2).clear(), __privateGet(this, _t2).clear(), __privateGet(this, _e3).splice(0);
  }
  report(r = this.defaultFlush) {
    let t = [], i2 = false;
    for (let n2 = __privateGet(this, _e3).length - 1; n2 >= 0; n2--) this.end(__privateGet(this, _e3)[n2].label);
    for (let [n2, { value: s }] of __privateGet(this, _r2).entries()) {
      if (__privateGet(this, _t2).has(n2)) continue;
      t.length === 0 && (i2 = true, t.push("Hits:"));
      let l2 = n2.split("//").length;
      t.push(`${"  ".repeat(l2)}${n2} ${ue(Ct(`× ${s}`))}`);
    }
    __privateGet(this, _t2).size > 0 && i2 && t.push(`
Timers:`);
    let o = -1 / 0, a2 = /* @__PURE__ */ new Map();
    for (let [n2, { value: s }] of __privateGet(this, _t2)) {
      let l2 = `${(Number(s) / 1e6).toFixed(2)}ms`;
      a2.set(n2, l2), o = Math.max(o, l2.length);
    }
    for (let n2 of __privateGet(this, _t2).keys()) {
      let s = n2.split("//").length;
      t.push(`${ue(`[${a2.get(n2).padStart(o, " ")}]`)}${"  ".repeat(s - 1)}${s === 1 ? " " : ue(" ↳ ")}${n2.split("//").pop()} ${__privateGet(this, _r2).get(n2).value === 1 ? "" : ue(Ct(`× ${__privateGet(this, _r2).get(n2).value}`))}`.trimEnd());
    }
    r(`
${t.join(`
`)}
`), this.reset();
  }
  [Symbol.dispose]() {
    fe && this.report();
  }
}, _r2 = new WeakMap(), _t2 = new WeakMap(), _e3 = new WeakMap(), __name(_i, "At"), _i);
function ue(e) {
  return `\x1B[2m${e}\x1B[22m`;
}
__name(ue, "ue");
function Ct(e) {
  return `\x1B[34m${e}\x1B[39m`;
}
__name(Ct, "Ct");
function gu(e, { file: r = "input.css", minify: t = false, map: i2 } = {}) {
  var _a2, _b2;
  function o(l2, u2) {
    return transform({ filename: r, code: l2, minify: t, sourceMap: typeof u2 < "u", inputSourceMap: u2, drafts: { customMedia: true }, nonStandard: { deepSelectorCombinator: true }, include: Features.Nesting | Features.MediaQueries, exclude: Features.LogicalProperties | Features.DirSelector | Features.LightDark, targets: { safari: 16 << 16 | 1024, ios_saf: 16 << 16 | 1024, firefox: 8388608, chrome: 7274496 }, errorRecovery: true });
  }
  __name(o, "o");
  let a2 = o(Buffer.from(e), i2);
  if (i2 = (_a2 = a2.map) == null ? void 0 : _a2.toString(), a2.warnings = a2.warnings.filter((l2) => !/'(deep|slotted|global)' is not recognized as a valid pseudo-/.test(l2.message)), a2.warnings.length > 0) {
    let l2 = e.split(`
`), u2 = [`Found ${a2.warnings.length} ${a2.warnings.length === 1 ? "warning" : "warnings"} while optimizing generated CSS:`];
    for (let [p, f2] of a2.warnings.entries()) {
      u2.push(""), a2.warnings.length > 1 && u2.push(`Issue #${p + 1}:`);
      let c2 = 2, m = Math.max(0, f2.loc.line - c2 - 1), d2 = Math.min(l2.length, f2.loc.line + c2), x2 = l2.slice(m, d2).map((h2, I) => m + I + 1 === f2.loc.line ? `${ee("│")} ${h2}` : ee(`│ ${h2}`));
      x2.splice(f2.loc.line - m, 0, `${ee("┆")}${" ".repeat(f2.loc.column - 1)} ${Zr(`${ee("^--")} ${f2.message}`)}`, `${ee("┆")}`), u2.push(...x2);
    }
    u2.push(""), console.warn(u2.join(`
`));
  }
  a2 = o(a2.code, i2), i2 = (_b2 = a2.map) == null ? void 0 : _b2.toString();
  let n2 = a2.code.toString(), s = new MagicString(n2);
  if (s.replaceAll("@media not (", "@media not all and ("), i2 !== void 0 && s.hasChanged()) {
    let l2 = s.generateMap({ source: "original", hires: "boundary" }).toString();
    i2 = remapping([l2, i2], () => null).toString();
  }
  return n2 = s.toString(), { code: n2, map: i2 };
}
__name(gu, "gu");
function ee(e) {
  return `\x1B[2m${e}\x1B[22m`;
}
__name(ee, "ee");
function Zr(e) {
  return `\x1B[33m${e}\x1B[39m`;
}
__name(Zr, "Zr");
function Jr(e) {
  var _a2;
  let r = new SourceMapGenerator(), t = 1, i2 = new g((o) => ({ url: (o == null ? void 0 : o.url) ?? `<unknown ${t++}>`, content: (o == null ? void 0 : o.content) ?? "<none>" }));
  for (let o of e.mappings) {
    let a2 = i2.get(((_a2 = o.originalPosition) == null ? void 0 : _a2.source) ?? null);
    r.addMapping({ generated: o.generatedPosition, original: o.originalPosition, source: a2.url, name: o.name }), r.setSourceContent(a2.url, a2.content);
  }
  return r.toString();
}
__name(Jr, "Jr");
function yu(e) {
  let r = typeof e == "string" ? e : Jr(e);
  return { raw: r, get inline() {
    let t = "";
    return t += "/*# sourceMappingURL=data:application/json;base64,", t += Buffer.from(r, "utf-8").toString("base64"), t += ` */
`, t;
  } };
}
__name(yu, "yu");
if (!process.versions.bun) {
  let e = ce.createRequire(import.meta.url);
  (_j = ce.register) == null ? void 0 : _j.call(ce, pathToFileURL(e.resolve("@tailwindcss/node/esm-cache-loader")));
}
var i = Object.defineProperty;
var a = Object.getOwnPropertyDescriptor;
var f = Object.getOwnPropertyNames;
var l = Object.prototype.hasOwnProperty;
var n = /* @__PURE__ */ __name((r, e) => {
  for (var t in e) i(r, t, { get: e[t], enumerable: true });
}, "n"), u = /* @__PURE__ */ __name((r, e, t, o) => {
  if (e && typeof e == "object" || typeof e == "function") for (let c2 of f(e)) !l.call(r, c2) && c2 !== t && i(r, c2, { get: /* @__PURE__ */ __name(() => e[c2], "get"), enumerable: !(o = a(e, c2)) || o.enumerable });
  return r;
}, "u");
var h = /* @__PURE__ */ __name((r) => u(i({}, "__esModule", { value: true }), r), "h");
var d = {};
n(d, { clearRequireCache: /* @__PURE__ */ __name(() => q$1, "clearRequireCache") });
var requireCache = h(d);
function q$1(r) {
  for (let e of r) delete require.cache[e];
}
__name(q$1, "q$1");
function commonjsRequire(path2) {
  throw new Error('Could not dynamically require "' + path2 + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
__name(commonjsRequire, "commonjsRequire");
var oxide = { exports: {} };
const name = "@tailwindcss/oxide-darwin-arm64";
const version = "4.1.18";
const repository = {
  type: "git",
  url: "git+https://github.com/tailwindlabs/tailwindcss.git",
  directory: "crates/node/npm/darwin-arm64"
};
const os = [
  "darwin"
];
const cpu = [
  "arm64"
];
const main = "tailwindcss-oxide.darwin-arm64.node";
const files = [
  "tailwindcss-oxide.darwin-arm64.node"
];
const publishConfig = {
  provenance: true,
  access: "public"
};
const license = "MIT";
const engines = {
  node: ">= 10"
};
const require$$28 = {
  name,
  version,
  repository,
  os,
  cpu,
  main,
  files,
  publishConfig,
  license,
  engines
};
const { readFileSync } = require$$2;
let nativeBinding = null;
const loadErrors = [];
const isMusl = /* @__PURE__ */ __name(() => {
  let musl = false;
  if (process.platform === "linux") {
    musl = isMuslFromFilesystem();
    if (musl === null) {
      musl = isMuslFromReport();
    }
    if (musl === null) {
      musl = isMuslFromChildProcess();
    }
  }
  return musl;
}, "isMusl");
const isFileMusl = /* @__PURE__ */ __name((f2) => f2.includes("libc.musl-") || f2.includes("ld-musl-"), "isFileMusl");
const isMuslFromFilesystem = /* @__PURE__ */ __name(() => {
  try {
    return readFileSync("/usr/bin/ldd", "utf-8").includes("musl");
  } catch {
    return null;
  }
}, "isMuslFromFilesystem");
const isMuslFromReport = /* @__PURE__ */ __name(() => {
  var _a2;
  let report = null;
  if (typeof ((_a2 = process.report) == null ? void 0 : _a2.getReport) === "function") {
    process.report.excludeNetwork = true;
    report = process.report.getReport();
  }
  if (!report) {
    return null;
  }
  if (report.header && report.header.glibcVersionRuntime) {
    return false;
  }
  if (Array.isArray(report.sharedObjects)) {
    if (report.sharedObjects.some(isFileMusl)) {
      return true;
    }
  }
  return false;
}, "isMuslFromReport");
const isMuslFromChildProcess = /* @__PURE__ */ __name(() => {
  try {
    return require("child_process").execSync("ldd --version", { encoding: "utf8" }).includes("musl");
  } catch (e) {
    return false;
  }
}, "isMuslFromChildProcess");
function requireNative() {
  var _a2, _b2, _c2, _d2;
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
    try {
      return commonjsRequire(process.env.NAPI_RS_NATIVE_LIBRARY_PATH);
    } catch (err) {
      loadErrors.push(err);
    }
  } else if (process.platform === "android") {
    if (process.arch === "arm64") {
      try {
        return require("./tailwindcss-oxide.android-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-android-arm64");
        const bindingPackageVersion = require("@tailwindcss/oxide-android-arm64/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm") {
      try {
        return require("./tailwindcss-oxide.android-arm-eabi.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-android-arm-eabi");
        const bindingPackageVersion = require("@tailwindcss/oxide-android-arm-eabi/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on Android ${process.arch}`));
    }
  } else if (process.platform === "win32") {
    if (process.arch === "x64") {
      if (((_b2 = (_a2 = process.config) == null ? void 0 : _a2.variables) == null ? void 0 : _b2.shlib_suffix) === "dll.a" || ((_d2 = (_c2 = process.config) == null ? void 0 : _c2.variables) == null ? void 0 : _d2.node_target_type) === "shared_library") {
        try {
          return require("./tailwindcss-oxide.win32-x64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-win32-x64-gnu");
          const bindingPackageVersion = require("@tailwindcss/oxide-win32-x64-gnu/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require("./tailwindcss-oxide.win32-x64-msvc.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-win32-x64-msvc");
          const bindingPackageVersion = require("@tailwindcss/oxide-win32-x64-msvc/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "ia32") {
      try {
        return require("./tailwindcss-oxide.win32-ia32-msvc.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-win32-ia32-msvc");
        const bindingPackageVersion = require("@tailwindcss/oxide-win32-ia32-msvc/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm64") {
      try {
        return require("./tailwindcss-oxide.win32-arm64-msvc.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-win32-arm64-msvc");
        const bindingPackageVersion = require("@tailwindcss/oxide-win32-arm64-msvc/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on Windows: ${process.arch}`));
    }
  } else if (process.platform === "darwin") {
    try {
      return require("./tailwindcss-oxide.darwin-universal.node");
    } catch (e) {
      loadErrors.push(e);
    }
    try {
      const binding = require("@tailwindcss/oxide-darwin-universal");
      const bindingPackageVersion = require("@tailwindcss/oxide-darwin-universal/package.json").version;
      if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
        throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
      }
      return binding;
    } catch (e) {
      loadErrors.push(e);
    }
    if (process.arch === "x64") {
      try {
        return require("./tailwindcss-oxide.darwin-x64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-darwin-x64");
        const bindingPackageVersion = require("@tailwindcss/oxide-darwin-x64/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm64") {
      try {
        return require("./tailwindcss-oxide.darwin-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-darwin-arm64");
        const bindingPackageVersion = require$$28.version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") ;
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on macOS: ${process.arch}`));
    }
  } else if (process.platform === "freebsd") {
    if (process.arch === "x64") {
      try {
        return require("./tailwindcss-oxide.freebsd-x64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-freebsd-x64");
        const bindingPackageVersion = require("@tailwindcss/oxide-freebsd-x64/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm64") {
      try {
        return require("./tailwindcss-oxide.freebsd-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-freebsd-arm64");
        const bindingPackageVersion = require("@tailwindcss/oxide-freebsd-arm64/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on FreeBSD: ${process.arch}`));
    }
  } else if (process.platform === "linux") {
    if (process.arch === "x64") {
      if (isMusl()) {
        try {
          return require("./tailwindcss-oxide.linux-x64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-x64-musl");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-x64-musl/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require("./tailwindcss-oxide.linux-x64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-x64-gnu");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-x64-gnu/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "arm64") {
      if (isMusl()) {
        try {
          return require("./tailwindcss-oxide.linux-arm64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-arm64-musl");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-arm64-musl/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require("./tailwindcss-oxide.linux-arm64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-arm64-gnu");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-arm64-gnu/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "arm") {
      if (isMusl()) {
        try {
          return require("./tailwindcss-oxide.linux-arm-musleabihf.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-arm-musleabihf");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-arm-musleabihf/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require("./tailwindcss-oxide.linux-arm-gnueabihf.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-arm-gnueabihf");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-arm-gnueabihf/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "loong64") {
      if (isMusl()) {
        try {
          return require("./tailwindcss-oxide.linux-loong64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-loong64-musl");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-loong64-musl/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require("./tailwindcss-oxide.linux-loong64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-loong64-gnu");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-loong64-gnu/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "riscv64") {
      if (isMusl()) {
        try {
          return require("./tailwindcss-oxide.linux-riscv64-musl.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-riscv64-musl");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-riscv64-musl/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      } else {
        try {
          return require("./tailwindcss-oxide.linux-riscv64-gnu.node");
        } catch (e) {
          loadErrors.push(e);
        }
        try {
          const binding = require("@tailwindcss/oxide-linux-riscv64-gnu");
          const bindingPackageVersion = require("@tailwindcss/oxide-linux-riscv64-gnu/package.json").version;
          if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
            throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
          }
          return binding;
        } catch (e) {
          loadErrors.push(e);
        }
      }
    } else if (process.arch === "ppc64") {
      try {
        return require("./tailwindcss-oxide.linux-ppc64-gnu.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-linux-ppc64-gnu");
        const bindingPackageVersion = require("@tailwindcss/oxide-linux-ppc64-gnu/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "s390x") {
      try {
        return require("./tailwindcss-oxide.linux-s390x-gnu.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-linux-s390x-gnu");
        const bindingPackageVersion = require("@tailwindcss/oxide-linux-s390x-gnu/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on Linux: ${process.arch}`));
    }
  } else if (process.platform === "openharmony") {
    if (process.arch === "arm64") {
      try {
        return require("./tailwindcss-oxide.openharmony-arm64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-openharmony-arm64");
        const bindingPackageVersion = require("@tailwindcss/oxide-openharmony-arm64/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "x64") {
      try {
        return require("./tailwindcss-oxide.openharmony-x64.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-openharmony-x64");
        const bindingPackageVersion = require("@tailwindcss/oxide-openharmony-x64/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else if (process.arch === "arm") {
      try {
        return require("./tailwindcss-oxide.openharmony-arm.node");
      } catch (e) {
        loadErrors.push(e);
      }
      try {
        const binding = require("@tailwindcss/oxide-openharmony-arm");
        const bindingPackageVersion = require("@tailwindcss/oxide-openharmony-arm/package.json").version;
        if (bindingPackageVersion !== "4.1.18" && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== "0") {
          throw new Error(`Native binding package version mismatch, expected 4.1.18 but got ${bindingPackageVersion}. You can reinstall dependencies to fix this issue.`);
        }
        return binding;
      } catch (e) {
        loadErrors.push(e);
      }
    } else {
      loadErrors.push(new Error(`Unsupported architecture on OpenHarmony: ${process.arch}`));
    }
  } else {
    loadErrors.push(new Error(`Unsupported OS: ${process.platform}, architecture: ${process.arch}`));
  }
}
__name(requireNative, "requireNative");
nativeBinding = requireNative();
if (!nativeBinding || process.env.NAPI_RS_FORCE_WASI) {
  let wasiBinding = null;
  let wasiBindingError = null;
  try {
    wasiBinding = require("./tailwindcss-oxide.wasi.cjs");
    nativeBinding = wasiBinding;
  } catch (err) {
    if (process.env.NAPI_RS_FORCE_WASI) {
      wasiBindingError = err;
    }
  }
  if (!nativeBinding) {
    try {
      wasiBinding = require("@tailwindcss/oxide-wasm32-wasi");
      nativeBinding = wasiBinding;
    } catch (err) {
      if (process.env.NAPI_RS_FORCE_WASI) {
        wasiBindingError.cause = err;
        loadErrors.push(err);
      }
    }
  }
  if (process.env.NAPI_RS_FORCE_WASI === "error" && !wasiBinding) {
    const error = new Error("WASI binding not found and NAPI_RS_FORCE_WASI is set to error");
    error.cause = wasiBindingError;
    throw error;
  }
}
if (!nativeBinding) {
  if (loadErrors.length > 0) {
    throw new Error(
      `Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try \`npm i\` again after removing both package-lock.json and node_modules directory.`,
      {
        cause: loadErrors.reduce((err, cur) => {
          cur.cause = err;
          return cur;
        })
      }
    );
  }
  throw new Error(`Failed to load native binding`);
}
oxide.exports = nativeBinding;
var Scanner = oxide.exports.Scanner = nativeBinding.Scanner;
var z = /* @__PURE__ */ __name((r, s) => (s = Symbol[r]) ? s : Symbol.for("Symbol." + r), "z"), O = /* @__PURE__ */ __name((r) => {
  throw TypeError(r);
}, "O");
var w = /* @__PURE__ */ __name((r, s, e) => {
  if (s != null) {
    typeof s != "object" && typeof s != "function" && O("Object expected");
    var t, d2;
    t === void 0 && (t = s[z("dispose")], e), typeof t != "function" && O("Object not disposable"), d2 && (t = /* @__PURE__ */ __name(function() {
      try {
        d2.call(this);
      } catch (f2) {
        return Promise.reject(f2);
      }
    }, "t")), r.push([e, t, s]);
  }
  return s;
}, "w"), P = /* @__PURE__ */ __name((r, s, e) => {
  var t = typeof SuppressedError == "function" ? SuppressedError : function(u2, g2, n2, l2) {
    return l2 = Error(n2), l2.name = "SuppressedError", l2.error = u2, l2.suppressed = g2, l2;
  }, d2 = /* @__PURE__ */ __name((u2) => s = e ? new t(u2, s, "An error was suppressed during disposal") : (e = true, u2), "d"), f2 = /* @__PURE__ */ __name((u2) => {
    for (; u2 = r.pop(); ) try {
      var g2 = u2[1] && u2[1].call(u2[2]);
      if (u2[0]) return Promise.resolve(g2).then(f2, (n2) => (d2(n2), f2()));
    } catch (n2) {
      d2(n2);
    }
    if (e) throw s;
  }, "f");
  return f2();
}, "P");
var c = pe.DEBUG, x = /[?&](?:worker|sharedworker|raw|url)\b/, M = /\?commonjs-proxy/, B = /[?&]index\=\d+\.css$/;
function q(r = {}) {
  let e = null, t = new E((n2) => /* @__PURE__ */ new Map()), d2 = false, f2 = true, u2 = true;
  function g2(n2, l2) {
    let i2, a2;
    if (n2) {
      let o = D$1.createIdResolver(n2.config, { ...n2.config.resolve, extensions: [".css"], mainFields: ["style"], conditions: ["style", "development|production"], tryIndex: false, preferRelative: true }), p = D$1.createIdResolver(n2.config, n2.config.resolve);
      i2 = /* @__PURE__ */ __name((m, v2) => o(n2, m, v2, true), "i"), a2 = /* @__PURE__ */ __name((m, v2) => p(n2, m, v2, true), "a");
    } else {
      let o = e.createResolver({ ...e.resolve, extensions: [".css"], mainFields: ["style"], conditions: ["style", "development|production"], tryIndex: false, preferRelative: true }), p = e.createResolver(e.resolve);
      i2 = /* @__PURE__ */ __name((m, v2) => o(m, v2, true, d2), "i"), a2 = /* @__PURE__ */ __name((m, v2) => p(m, v2, true, d2), "a");
    }
    return new F(l2, e.root, (e == null ? void 0 : e.css.devSourcemap) ?? false, i2, a2);
  }
  __name(g2, "g");
  return [{ name: "@tailwindcss/vite:scan", enforce: "pre", configureServer(n2) {
  }, async configResolved(n2) {
    e = n2, d2 = e.build.ssr !== false && e.build.ssr !== void 0, r.optimize !== void 0 && (f2 = r.optimize !== false), u2 = f2 && e.build.cssMinify !== false, typeof r.optimize == "object" && (u2 = r.optimize.minify !== false);
  } }, { name: "@tailwindcss/vite:generate:serve", apply: "serve", enforce: "pre", transform: { filter: { id: { exclude: [/\/\.vite\//, x, M], include: [/\.css(?:\?.*)?$/, /&lang\.css/, B] } }, async handler(n2, l2) {
    var _a2;
    var m = [];
    try {
      if (!V(l2)) return;
      let i2 = w(m, new At());
      c && i2.start("[@tailwindcss/vite] Generate CSS (serve)");
      let a2 = t.get(((_a2 = this.environment) == null ? void 0 : _a2.name) ?? "default");
      let o = a2.get(l2);
      o || (o ?? (o = g2(this.environment ?? null, l2)), a2.set(l2, o));
      let p = await o.generate(n2, (R) => this.addWatchFile(R), i2);
      if (!p) return a2.delete(l2), n2;
      c && i2.end("[@tailwindcss/vite] Generate CSS (serve)");
      return p;
    } catch (v2) {
      var S2 = v2, y2 = true;
    } finally {
      P(m, S2, y2);
    }
  } } }, { name: "@tailwindcss/vite:generate:build", apply: "build", enforce: "pre", transform: { filter: { id: { exclude: [/\/\.vite\//, x, M], include: [/\.css(?:\?.*)?$/, /&lang\.css/, B] } }, async handler(n2, l2) {
    var _a2;
    var m = [];
    try {
      if (!V(l2)) return;
      let i2 = w(m, new At());
      c && i2.start("[@tailwindcss/vite] Generate CSS (build)");
      let a2 = t.get(((_a2 = this.environment) == null ? void 0 : _a2.name) ?? "default");
      let o = a2.get(l2);
      o || (o ?? (o = g2(this.environment ?? null, l2)), a2.set(l2, o));
      let p = await o.generate(n2, (R) => this.addWatchFile(R), i2);
      if (!p) return a2.delete(l2), n2;
      c && i2.end("[@tailwindcss/vite] Generate CSS (build)");
      f2 && (c && i2.start("[@tailwindcss/vite] Optimize CSS"), p = gu(p.code, { minify: u2, map: p.map }), c && i2.end("[@tailwindcss/vite] Optimize CSS"));
      return p;
    } catch (v2) {
      var S2 = v2, y2 = true;
    } finally {
      P(m, S2, y2);
    }
  } } }];
}
__name(q, "q");
function k(r) {
  let [s] = r.split("?", 2);
  return path9__default.extname(s).slice(1);
}
__name(k, "k");
function V(r) {
  return r.includes("/.vite/") || x.test(r) || M.test(r) ? false : k(r) === "css" || r.includes("&lang.css") || r.match(B);
}
__name(V, "V");
function G(r) {
  return path9__default.resolve(r.replace(/\?.*$/, ""));
}
__name(G, "G");
var E = (_k = class extends Map {
  constructor(e) {
    super();
    this.factory = e;
  }
  get(e) {
    let t = super.get(e);
    return t === void 0 && (t = this.factory(e, this), this.set(e, t)), t;
  }
}, __name(_k, "E"), _k), F = (_l = class {
  constructor(s, e, t, d2, f2) {
    __publicField(this, "compiler");
    __publicField(this, "scanner");
    __publicField(this, "candidates", /* @__PURE__ */ new Set());
    __publicField(this, "buildDependencies", /* @__PURE__ */ new Map());
    this.id = s;
    this.base = e;
    this.enableSourceMaps = t;
    this.customCssResolver = d2;
    this.customJsResolver = f2;
  }
  async generate(s, e, t) {
    let d2 = G(this.id);
    function f2(i2) {
      i2 !== d2 && (/[\#\?].*\.svg$/.test(i2) || e(i2));
    }
    __name(f2, "f");
    let u2 = this.requiresBuild(), g2 = path9__default.dirname(path9__default.resolve(d2));
    if (!this.compiler || !this.scanner || await u2) {
      requireCache.clearRequireCache(Array.from(this.buildDependencies.keys())), this.buildDependencies.clear(), this.addBuildDependency(G(d2)), c && t.start("Setup compiler");
      let i2 = [];
      this.compiler = await lu(s, { from: this.enableSourceMaps ? this.id : void 0, base: g2, shouldRewriteUrls: true, onDependency: /* @__PURE__ */ __name((o) => {
        f2(o), i2.push(this.addBuildDependency(o));
      }, "onDependency"), customCssResolver: this.customCssResolver, customJsResolver: this.customJsResolver }), await Promise.all(i2), c && t.end("Setup compiler"), c && t.start("Setup scanner");
      let a2 = (this.compiler.root === "none" ? [] : this.compiler.root === null ? [{ base: this.base, pattern: "**/*", negated: false }] : [{ ...this.compiler.root, negated: false }]).concat(this.compiler.sources);
      this.scanner = new Scanner({ sources: a2 }), c && t.end("Setup scanner");
    } else for (let i2 of this.buildDependencies.keys()) f2(i2);
    if (!(this.compiler.features & (Features$1.AtApply | Features$1.JsPluginCompat | Features$1.ThemeFunction | Features$1.Utilities))) return false;
    if (this.compiler.features & Features$1.Utilities) {
      c && t.start("Scan for candidates");
      for (let i2 of this.scanner.scan()) this.candidates.add(i2);
      c && t.end("Scan for candidates");
    }
    if (this.compiler.features & Features$1.Utilities) {
      for (let i2 of this.scanner.files) f2(i2);
      for (let i2 of this.scanner.globs) {
        if (i2.pattern[0] === "!") continue;
        let a2 = path9__default.relative(this.base, i2.base);
        a2[0] !== "." && (a2 = "./" + a2), a2 = $e(a2), f2(path9__default.posix.join(a2, i2.pattern));
        let o = this.compiler.root;
        if (o !== "none" && o !== null) {
          let p = $e(path9__default.resolve(o.base, o.pattern));
          if (!await de.stat(p).then((v2) => v2.isDirectory(), () => false)) throw new Error(`The path given to \`source(…)\` must be a directory but got \`source(${p})\` instead.`);
        }
      }
    }
    c && t.start("Build CSS");
    let n2 = this.compiler.build([...this.candidates]);
    c && t.end("Build CSS"), c && t.start("Build Source Map");
    let l2 = this.enableSourceMaps ? yu(this.compiler.buildSourceMap()).raw : void 0;
    return c && t.end("Build Source Map"), { code: n2, map: l2 };
  }
  async addBuildDependency(s) {
    let e = null;
    try {
      e = (await de.stat(s)).mtimeMs;
    } catch {
    }
    this.buildDependencies.set(s, e);
  }
  async requiresBuild() {
    for (let [s, e] of this.buildDependencies) {
      if (e === null) return true;
      try {
        if ((await de.stat(s)).mtimeMs > e) return true;
      } catch {
        return true;
      }
    }
    return false;
  }
}, __name(_l, "F"), _l);
export {
  q as default
};
