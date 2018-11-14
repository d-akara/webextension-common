import * as polyfill from 'webextension-polyfill'

// Interface mapping for cross browser web extension API
export interface Window {
    browser?: typeof browser;
    chrome?: typeof browser;
    msBrowser?: typeof browser;
}
declare var window:Window;
window['browser'] =  window.msBrowser || window.browser || window.chrome;

console.log('webextension-polyfill: polyfills installed', polyfill);  // note. we must reference polyfill or it will not be imported and included