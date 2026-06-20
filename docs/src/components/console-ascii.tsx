"use client";

import { useEffect } from "react";

const farmAscii = String.raw`
  __                         _     
 / _| __ _ _ __ _ __ ___    (_)___
| |_ / _' | '__| '_ ' _ \   | / __|
|  _| (_| | |  | | | | | |_ | \__ \
|_|  \__,_|_|  |_| |_| |_(_)/ |___/
                         |__/      
`;

export function ConsoleAscii() {
  useEffect(() => {
    console.log(
      `%c${farmAscii}%c\nAccelerate your product shipping.`,
      "color:#ffffff;background:transparent;font-family:monospace;font-size:12px;line-height:1.2;font-weight:700;",
      "color:#9ca3af;background:transparent;font-family:monospace;font-size:11px;",
    );
  }, []);

  return null;
}
