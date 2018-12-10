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
            console.log.apply(null, [content.loggerId + ':', ...content.messages])
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
    return browser.tabs.query({ active: true, windowType:'normal' }).then((tabs) => {
        return browser.tabs.sendMessage(tabs[0].id, message)
    });
}

export function sendMessageActiveTab(message:ExtensionMessage) {
    if (isDevtools()) {  // devtools in firefox doesn't have access to tabs, so we must proxy through the background
        return sendMessageExtensionPages({event:'webextension.proxy.sendMessageActiveTab', content: {tabId: browser.devtools.inspectedWindow.tabId, message}})
    } else
        return _sendMessageActiveTab(message)
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

export function createWindow(url:string) {
    return browser.windows.create({type:'popup',url})
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
    const keysDown = new Set()
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

export function makeLogger(loggerId:string) {
    if (isBackground()) {
        return {
            log: (...messages) => {
                console.log.apply(this, [loggerId + ':', ...messages])
            }
        }
    }
    return {
        log: (...messages) => {
            const extensionMessage = {event:'webextension.logger', content: {loggerId, messages}}
            sendMessageExtensionPages(extensionMessage)
        }
    }
}

export namespace devtools {
    export function createPanel(name, icon, html) {
        return browser.devtools.panels.create(name, icon, html)
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

function isBackground() {
    if (!browser.extension.getBackgroundPage) return false // occurs in content script
    return browser.extension.getBackgroundPage() === window
}

function isDevtools() {return browser.devtools ? true:false}