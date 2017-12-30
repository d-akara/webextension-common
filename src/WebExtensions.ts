import { EventSource } from './WebExtensions';
// future use
//browser.tabs.executeScript(tab.id, {code:"document.body.appendChild(document.createElement('script')).src = 'url';"})

export enum KeySpecial {
    Shift   = "Shift",
    Space   = "Space",
    Tab     = "Tab",
    Control = "Control",
    Alt     = "Alt",
    Meta    = "Meta",
    Enter   = "Enter"
}

type Key = KeySpecial | string

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
            event.preventDefault()
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

function allKeysDown(queryKeys:[Key], keysDown:Set<Key>) {
    return queryKeys.every(key=>keysDown.has(key))
}
export function keyChordEventListener(keys:[Key], onAllKeys:Function) {
    const keysDown = new Set()
    window.addEventListener('keydown', event =>{
        keysDown.add(event.key)
        if (allKeysDown(keys, keysDown)) {
            onAllKeys();
        }
    }, {capture:true});

    window.addEventListener('keyup', event =>{
        keysDown.delete(event.key)
    }, {capture:true});
}
