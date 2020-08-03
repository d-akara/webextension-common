import * as polyfill from 'webextension-polyfill'

// Interface mapping for cross browser web extension API
export interface Window {
    browser?: typeof browser;
    chrome?: typeof browser;
    msBrowser?: typeof browser;
}
declare var window:Window;
window['browser'] = polyfill

console.log('webextension-polyfill: polyfills installed - %c%s', 'color:green', document.location.toString(), polyfill);  // note. we must reference polyfill or it will not be imported and included

export const INCLUDE="" // without something concrete, this file will not be included in the JS output when doing export *