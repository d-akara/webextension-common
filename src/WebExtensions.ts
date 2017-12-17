import { EventSource } from './WebExtensions';
// future use
//browser.tabs.executeScript(tab.id, {code:"document.body.appendChild(document.createElement('script')).src = 'url';"})

export enum Key {
    Shift   = "Shift",
    Space   = "Space",
    Tab     = "Tab",
    Control = "Control",
    Alt     = "Alt",
    Meta    = "Meta",
    Enter   = "Enter"
}

export type EventSource = {
    tabId: number,
    url: string,
    processId: number,
    frameId: number,
    timeStamp: number
}
interface ExtensionMessage {
    event:string,
    content?:Object
}
export function sendMessageActiveTab(message:ExtensionMessage) {
    return browser.tabs.query({ active: true, windowType:'normal' }).then((tabs) => {
        return browser.tabs.sendMessage(tabs[0].id, message)
    });
}

export function sendMessage(message:ExtensionMessage) {
    return browser.runtime.sendMessage(message)
}

export function subscribeMessages(event:string, onMessage:(message:ExtensionMessage, sender:browser.runtime.MessageSender)=>any) {
    browser.runtime.onMessage.addListener((eMessage, eSender, eCallback)=>{
       if (eMessage.event === event) {
           const reply = onMessage(eMessage, eSender);
           // if promise, return
           if(reply instanceof Promise) return reply;
           // if not a promise, wrap in a promise.  If we don't wrap, this fails in FF
           return new Promise(resolve=>resolve(reply));
        }
    });
}

export function subscribeKeyCommandEvents(command:(command:string)=>void) {
    browser.commands.onCommand.addListener(command);
}

export function createWindow(url:string) {
    return browser.windows.create({type:'popup',url})
}

export function listenContentLoaded(onContentLoaded:(arg:EventSource)=>void) {
    browser.webNavigation.onDOMContentLoaded.addListener(onContentLoaded)
}

export function doubleTapKeyEventListener(key:Key, onDoubleTap:Function) {
    let lastKeyEvent:KeyboardEvent = new KeyboardEvent('keydown', {key});
    let lastKeyEventTime;
    document.addEventListener('keydown', event =>{
        if (event.key === key && lastKeyEvent.key === event.key) {
            const keydownTime = performance.now();
            if (keydownTime - lastKeyEventTime < 400) {
                lastKeyEventTime = 0;
                event.preventDefault()
                event.stopPropagation()
                onDoubleTap();
            } else
                lastKeyEventTime = keydownTime;
        }
        lastKeyEvent = event;
    },{capture:true});
}

export function keyEventListener(key:Key, onDoubleTap:Function) {
    let lastKeyEvent:KeyboardEvent = new KeyboardEvent('keydown', {key});
    let lastKeyEventTime;
    window.addEventListener('keydown', event =>{
        if (event.key === key && lastKeyEvent.key === event.key) {
            const keydownTime = performance.now();
            if (keydownTime - lastKeyEventTime < 400) {

                onDoubleTap();
            }
            lastKeyEventTime = keydownTime;
        }
        lastKeyEvent = event;
    }, );
}
