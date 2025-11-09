var s={};/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var k=Symbol.for("react.transitional.element"),n=Symbol.for("react.fragment");function E(v,r,t){var l=null;if(t!==void 0&&(l=""+t),r.key!==void 0&&(l=""+r.key),"key"in r){t={};for(var e in r)e!=="key"&&(t[e]=r[e])}else t=r;return r=t.ref,{$$typeof:k,type:v,key:l,ref:r!==void 0?r:null,props:t}}s.Fragment=n;s.jsx=E;s.jsxs=E;
