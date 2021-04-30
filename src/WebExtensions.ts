/*
 * Content scripts don't have access to the page script state or objects
 * However, we can inject a script that would use postMessage to send our extension information from the page script state
 * 
 * browser.tabs.executeScript(null, {code: "document.body.appendChild(document.createElement('script')).src='" + browser.runtime.getURL("pageInspector.js") +"';" }, null);
 * browser.tabs.executeScript(null, {file: "/path/to/file.js"})
 *
 * 
 * permission to send message from page script
 * "externally_connectable": {"matches": ["*://*.example.com/*"]}
 * permission to inject a local script
 * "web_accessible_resources": ["pageInspector.js"]
 * 
 */

/**
 * API's available to content scripts - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#WebExtension_APIs
 */

 /**
  * Example native messaging - https://medium.com/@joaoguedes.ishida/send-data-from-a-firefox-web-extension-to-a-python-script-and-create-a-simple-playlisting-app-for-a9436ac84624
  * 
  * Page script to background script messaging - https://developer.chrome.com/extensions/messaging#external-webpage
  * Page script to content script messaging - http://krasimirtsonev.com/blog/article/Send-message-from-web-page-to-chrome-extensions-background-script
  * 
  */

export enum KeySpecial {
    Shift   = "Shift",
    Space   = "Space",
    Tab     = "Tab",
    Control = "Control",
    Alt     = "Alt",
    Meta    = "Meta",
    Enter   = "Enter"
}

export type Key = KeySpecial | string

export type EventSource = {
    tabId: number,
    url: string,
    processId: number,
    frameId: number,
    timeStamp: number
}
export interface ExtensionMessage {
    event:string,
    content?:Object
    origin?:string
}

export interface ExtensionMessageResponse {
    tab?:browser.tabs.Tab,
    content?:Object,
    isError:boolean
}

namespace memoryStorage {
    const valueStore = new Map()
    export function startMemoryStorage() {
        subscribeMessages('webextension.store.setValue', event => {
            for (const key in event.content) {
                valueStore.set(key, event.content[key])
            }
        })
        subscribeMessages('webextension.store.getValue', event => {
            return valueStore.get(event.content)
        })
    }
    export function memSet(item: browser.storage.StorageObject) {
        if (isBackground()) {
            for (const key in item) {
                valueStore.set(key, item[key])
            }
            return Promise.resolve()
        }
        return sendMessageExtensionPages({event: 'webextension.store.setValue', content: item})
    }
    export function memGet(keys?: string|string[]|null): Promise<any> {
        if (isBackground()) {
            if (keys instanceof String)
                return Promise.resolve(valueStore.get(keys))
            else {
                const values = []
                for (const key of keys) {
                    values.push(valueStore.get(key))
                }
                return Promise.resolve(values)
            }
        }
        return sendMessageExtensionPages({event: 'webextension.store.getValue', content: keys})
    }
}

export namespace background {
    export function startLogReceiver() {
        subscribeMessages('webextension.logger', event => {
            const content = event.content as LoggerMessage

            console.log.apply(null, [{id: content.loggerId, origin: event.origin}, ...content.messages])
            // console.log.apply(null, [content.loggerId + ':' + event.origin + ':', ...content.messages])
        })
    }
    export function startMessageProxy() {
        subscribeMessages('webextension.proxy.sendMessageActiveTab', event => {
            const content = event.content as any
            return browser.tabs.sendMessage(content.tabId, content.message)
        })
    }
    export const startMemoryStorage = memoryStorage.startMemoryStorage
}

function _sendMessageActiveTab(message:ExtensionMessage) {
    if (log) {
        log.log('sendMessageActiveTab sending', message)
    }
    return browser.tabs.query({ active: true, windowType:'normal' }).then((tabs) => {
        return browser.tabs.sendMessage(tabs[0].id, message)
    });
}

export function sendMessageActiveTab(message:ExtensionMessage) {
    if (isDevtools()) {  // devtools in firefox doesn't have access to tabs, so we must proxy through the background
        const tabId = browser.devtools.inspectedWindow.tabId
        if (!tabId) {
            console.log('no tabId for inspected window', browser.devtools.inspectedWindow)
            return Promise.reject('no tabId')
        }
        return sendMessageExtensionPages({event:'webextension.proxy.sendMessageActiveTab', content: {tabId: browser.devtools.inspectedWindow.tabId, message}})
    } else
        return _sendMessageActiveTab(message)
}

export function sendMessageParentTab(message:ExtensionMessage) {
    // TODO get parent tab
    return browser.tabs.query({ active: true, windowType:'normal' }).then((tabs) => {
        return browser.tabs.sendMessage(tabs[0].id, message)
    });
}

export interface TabQuery {
    active?: boolean,
    audible?: boolean,
    cookieStoreId?: string,
    currentWindow?: boolean,
    discarded?: boolean,
    highlighted?: boolean,
    index?: number,
    muted?: boolean,
    lastFocusedWindow?: boolean,
    pinned?: boolean,
    status?: browser.tabs.TabStatus,
    title?: string,
    url?: string|string[],
    windowId?: number,
    windowType?: browser.tabs.WindowType
}

export async function sendMessageTabs(tabQuery: TabQuery, message:ExtensionMessage) {
    const tabs = await browser.tabs.query(tabQuery)
    const response = [] as ExtensionMessageResponse[]
    for (const tab of tabs) {
        let isError = false
        const tabResult = await browser.tabs.sendMessage(tab.id, message).catch(e=> {isError = true; return e})
        response.push({tab, content:tabResult, isError})
    }
    return response
    
}
interface PageMessageEvent {
    direction?: string
    event:string
    content?: any
}
export function sendMessageToPage(message:PageMessageEvent) {
    const target = window.location.protocol + '//' + window.location.host
    window.postMessage({
        ...message,
        direction: "from-content-script",
      }, target);
}

export async function tabFromId(tabId: number) {
    return await browser.tabs.get(tabId)
}

export function tabInfo(tab: browser.tabs.Tab) {
    return {title: tab.title, url: briefUrl(tab.url)}
}

export function sendMessageExtensionPages(message:ExtensionMessage) {
    return browser.runtime.sendMessage(message)
}

export function subscribeMessages(event:string, onMessage:(message:ExtensionMessage, sender:browser.runtime.MessageSender)=>any) {
    browser.runtime.onMessage.addListener((eMessage, eSender)=>{
       if (eMessage.event === event) {
           const reply = onMessage(eMessage, eSender);
           // if promise, return
           if(reply instanceof Promise) return reply;
           // if not a promise, wrap in a promise.  If we don't wrap, this fails in FF
           return new Promise(resolve=>resolve(reply));
        }
    });
}

export interface actionEvent {
    tab: browser.tabs.Tab
    action: typeof browser.browserAction
}

/**
 * Handle browser toolbar click
 * @param onAction 
 */
export function onBrowserAction(onAction: (action:actionEvent) => void) {
    browser.browserAction.onClicked.addListener(tab => {
        onAction({tab, action: browser.browserAction})
    })
}

/**
 * Performs action when key command is invoked as described in the manifest.json
 * @param command 
 */
export function subscribeKeyCommandEvents(command:(command:string)=>void) {
    browser.commands.onCommand.addListener(command);
}

interface WindowCreation {
    url?: string|string[]
    tabId?: number
    left?: number
    top?: number
    width?: number
    height?: number
    focused?: boolean,
    incognito?: boolean
    titlePreface?: string
    type?: browser.windows.CreateType
    state?: browser.windows.WindowState
}

interface TabCreation {
    active?: boolean
    cookieStoreId?: string
    index?: number
    openerTabId?: number
    pinned?: boolean
    url?: string
    windowId?: number
}

type TabUpdatedListener = (tabId: number, changeInfo: {
    audible?: boolean,
    discarded?: boolean,
    favIconUrl?: string,
    mutedInfo?: browser.tabs.MutedInfo,
    pinned?: boolean,
    status?: string,
    title?: string,
    url?: string,
}, tab: browser.tabs.Tab) => void

// browser.tabs.onUpdated.addListener((id, changeInfo, tab)
// seems to be the only listener that on chrome can be used to get status of tabs that we open with our extension
async function listenOnCompletedOnce<T>(tabId: number, listener:() => T) {
    const completed = makeDeferred<T>()
    const selfRemovingListener:TabUpdatedListener = (eventTabId, changeInfo, tab) => {
        if (tabId !== eventTabId) return
        if (changeInfo.status !== 'complete') return

        completed.resolve(listener())
        browser.tabs.onUpdated.removeListener(selfRemovingListener)
    }
    browser.tabs.onUpdated.addListener(selfRemovingListener)
    return completed
}

export const EVENT_ID_TAB_CREATE = 'webextension.tab.create'
export async function createWindow(window: WindowCreation) {
    const newWindow = await browser.windows.create({type:'popup', ...window})
    const tabId = newWindow.tabs[0].id
    return listenOnCompletedOnce(tabId, async () => {
        const creationMessage:ExtensionMessage = {event:EVENT_ID_TAB_CREATE, content:{tabId}}
        await browser.tabs.sendMessage(tabId, creationMessage)
        return newWindow
    })
}

export async function createTab(tab: TabCreation) {
    const newTab = await browser.tabs.create(tab)
    const tabId = newTab.id
    return listenOnCompletedOnce(tabId, async () => {
        const creationMessage:ExtensionMessage = {event:EVENT_ID_TAB_CREATE, content:{tabId}}
        await browser.tabs.sendMessage(tabId, creationMessage)
        return newTab
    })
}

export function listenContentLoaded(onContentLoaded:(arg:EventSource)=>void) {
    browser.webNavigation.onDOMContentLoaded.addListener(onContentLoaded)
}

// sequence mode toggle
// after sequence handle all keys until escape mode

export function textNodesTransform(fnTransform: (constent:string)=>string) {
    const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, null, false);
    let node:Text;
    while(node = walk.nextNode() as Text){
        node.textContent = fnTransform(node.textContent);
    }
}

export function keySequenceEventListener(keys:Key[], onSequence:Function) {
    let sequencePosition = 0;
    let lastKeyEventTime = 0;
    document.addEventListener('keydown', event =>{
        const keydownTime = performance.now();
        if ((lastKeyEventTime > 0) && (keydownTime - lastKeyEventTime > 400)) {
            // time expired to consider key strokes part of same sequence
            // reset sequence pointer to the beginning
            sequencePosition = 0;
        }
        lastKeyEventTime = keydownTime;

        if (event.key === keys[sequencePosition]) {
            sequencePosition++;
            // TODO prevent default after start sequence
            //event.preventDefault()
            event.stopPropagation()
            if (sequencePosition === keys.length) {
                sequencePosition = 0;
                lastKeyEventTime = 0;
                onSequence();
            }
        } else {
            sequencePosition = 0;
            lastKeyEventTime = 0;
        }
    },{capture:true});
}

function allKeysDown(queryKeys:Key[], keysDown:Set<Key>) {
    return queryKeys.every(key=>keysDown.has(key))
}
export function keyChordEventListener(keys:Key[], onAllKeys:Function) {
    const keysDown = new Set<Key>()
    window.addEventListener('keydown', event =>{
        keysDown.add(event.key)
        if (allKeysDown(keys, keysDown)) {
            // prevent default key handling when combination is pressed.
            // this is prevent characters printing like shift+enter combinations
            event.preventDefault()
            event.stopPropagation()
            onAllKeys();
        }
    }, {capture:true});

    window.addEventListener('keyup', event =>{
        keysDown.delete(event.key)
    }, {capture:true});
}

export interface LoggerMessage {
    loggerId:string,
    messages:object[]
}

export interface Logger {
    log: (...messages) => void
}

let log:Logger
export function setLogger(logger: Logger) {
    log = logger;
}

export function makeLogger(loggerId:string): Logger {
    if (isBackground()) {
        return {
            log: (...messages) => {
                console.log.apply(this, [{id: loggerId}, ...messages])
            }
        }
    }
    return {
        log: (...messages) => {
            const extensionMessage = {event:'webextension.logger', content: {loggerId, messages}, origin:briefUrl(document.location.toString(), 2)}
            sendMessageExtensionPages(extensionMessage)
        }
    }
}

export namespace devtools {
    export function createPanel(name, icon, html) {
        return browser.devtools.panels.create(name, icon, html)
    }
}

/**
 * functions specify to content script executed in extension context
 */
export namespace content {

    export function subscribePageMessages(eventId: string, handler: (message:any) => void) {
        window.addEventListener("message", (event) => {
            if (event.source != window) return  // only handle if from self
            const pageMessage:PageMessageEvent = event.data
            if ((pageMessage.direction == "from-page-script") && eventId === pageMessage.event) {
                handler(pageMessage.content)
            }
          });
    }

    export function observe(targetNode, listenerFn: (mutation:MutationRecord) => boolean | void, observerConfig?: MutationObserverInit) {
        const config = observerConfig || {
            attributes: true,
            attributeOldValue: true,
            characterData: true,
            characterDataOldValue: true,
            childList: true,
            subtree: true
        };

        const observer = new MutationObserver(mutationList => {
            for(const mutation of mutationList) {
                if (listenerFn(mutation)) {
                    observer.disconnect()
                    console.log('disconnected observer')
                    break;
                }
            }
        });

        observer.observe(targetNode, config);
    }

    const documentInterceptors = []
    export function interceptDocumentLoad(onDocumentLoad: (html:Element)=>void) {
        documentInterceptors.push(onDocumentLoad)

        if (documentInterceptors.length > 1) return // we are done, listener has already been created from previous call

        const originalHtml = document.replaceChild(document.createElement("html"), document.children[0]);
        document.addEventListener('DOMContentLoaded', event => {
            for (const interceptor of documentInterceptors) {
                interceptor(originalHtml)
            }
            document.replaceChild(originalHtml, document.children[0]);
        })
    }

    export function executeFile(filePath:string) {
        const url = browser.runtime.getURL(filePath)
        const scriptTag = document.createElement("script");
        scriptTag.src = url;
        scriptTag.type = "text/javascript";

        if (!document.head) {
            interceptDocumentLoad(html => html.querySelector('head').insertAdjacentElement('afterbegin', scriptTag))
        } else
            document.head.appendChild(scriptTag);
    }

    export function executeModule(filePath:string) {
        const url = browser.runtime.getURL(filePath)
        const scriptTag = document.createElement("script");
        scriptTag.src = url;
        scriptTag.type = "module";

        if (!document.head) {
            interceptDocumentLoad(html => html.querySelector('head').insertAdjacentElement('afterbegin', scriptTag))
        } else
            document.head.appendChild(scriptTag);
    }

    export function executeScript(scriptContent:string) {
        const scriptTag = document.createElement("script");
        scriptTag.type = "text/javascript";
        scriptTag.textContent = scriptContent

        if (!document.head) {
            interceptDocumentLoad(html => html.querySelector('head').insertAdjacentElement('afterbegin', scriptTag))
        } else
            document.head.appendChild(scriptTag);
    }
}

/**
 * functions for use within page injection
 */
export namespace page {
    export function subscribeExtensionMessages(eventId: string, handler: (message:any) => void) {
        window.addEventListener("message", (event) => {
            if (event.source != window) return  // only handle if from self
            const pageMessage:PageMessageEvent = event.data
            if ((pageMessage.direction == "from-content-script") && eventId === pageMessage.event) {
                handler(pageMessage.content)
            }
        });
    }

    /*
    Send a message to the page script.
    */
   export function sendMessageToContentScript(message: PageMessageEvent) {
    const target = window.location.protocol + '//' + window.location.host
    window.postMessage({
        ...message,
        direction: "from-page-script"
    }, target);
}    
}

export namespace storage {
    export function localSet(item: browser.storage.StorageObject) {
        return browser.storage.local.set(item)
    }
    export function localGet(keys?: string|string[]|null) {
        return browser.storage.local.get(keys)
    }
    export function syncSet(item: browser.storage.StorageObject) {
        return browser.storage.sync.set(item)
    }
    export function syncGet(keys?: string|string[]|null) {
        return browser.storage.sync.get(keys)
    }
    export const memSet = memoryStorage.memSet
    export const memGet = memoryStorage.memGet
}


export async function fetchExtensionFile(extensionFileLocation: string) {
    const fileUrl = browser.runtime.getURL(extensionFileLocation)
    const result = await fetch(fileUrl)
    const fileContent = await result.text()

    return fileContent
}

export function extensionUrl(localPath:string) {
    return browser.runtime.getURL(localPath)
}

/**
 * returns true for all pages except the background page
 */
function isBackground() {
    if (!browser.extension.getBackgroundPage) return false // occurs in content script
    return browser.extension.getBackgroundPage() === window
}

function isDevtools() {return browser.devtools ? true:false}

/**
 * Trimmed version of url with host and n number segments from the end
 * @param url 
 * @param count 
 */
function briefUrl(url:string, count:number = 2) {
    const uri = new URL(url)
    const segments = url.split('/')
    const last = segments.length - 1
    const first = Math.max(0, last - 1)
    const endSegments = segments.splice(first, last).join('/')
    if (uri.protocol === 'moz-extension:')
        return uri.protocol + '...' + endSegments
    return uri.hostname + '...' + endSegments
}

interface DeferredPromise<T> extends Promise<T> {
    resolve: (value?: T) => void
    reject: (reason?: any) => void
}

function makeDeferred<T>():DeferredPromise<T> {
    const deferred = {} as DeferredPromise<T>
    const promise = new Promise<T>((resolve, reject) => {
        deferred.resolve = resolve
        deferred.reject  = reject
    })
    deferred.then = (value) => promise.then(value)
    deferred.catch = (reason) => promise.catch(reason)
    deferred.finally = () => promise.finally()

    return deferred
}

export enum PageType {
    action = 'action',
    background = '_generated_background_page.html',
    content = 'content',
    devtools = 'devtools',
    devtoolsPanel = 'devtools-panel',
    options = 'options'
}

function pageContext() {
    const pageType = new URL(window.location.href).searchParams.get('page')
    const path = window.location.pathname
    const isExtensionPage = window.location.protocol.includes('extension')
    

    if (isExtensionPage) {
        if (pageType === PageType.action) {
            return PageType.action;
        }
        if (path.endsWith(PageType.background)) {
            return PageType.background;
        }
        if (pageType === PageType.devtools) {
            return PageType.devtools;
        }
        if (pageType === PageType.devtoolsPanel) {
            return PageType.devtoolsPanel;
        }
        if (pageType === PageType.options) {
            return PageType.options;
        }
    }

    // The content page location will be whatever is the current browser page the user is browsing.
    return PageType.content;
}

interface ExtensionModule {
    id: string
    page: PageType
    onInit: (log:Logger)=> void
}

export function initModule(module: ExtensionModule) {
    const currentPageType = pageContext();

    if (currentPageType === PageType.background && module.page === PageType.background) {
        console.log('initializing background processes')
        // start background processes
        background.startLogReceiver()
        background.startMemoryStorage()
        background.startMessageProxy()
    }

    if (module.page === currentPageType) {
        try {
            const log = makeLogger(module.id)
            setLogger(log)
            log.log('executing module')
            module.onInit(log)
            log.log('module initialized')
        
        } catch (error) {
            console.log(error)
            log.log(error.toString())
        }
    }
}
