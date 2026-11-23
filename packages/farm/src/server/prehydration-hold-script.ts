import { FARM_ISLAND_REPLAYABLE_SELECTOR } from "../island";

export function createPreHydrationClickQueueScript(): string {
  // Inlined into every document, so this stays hand-minified rather than
  // importing from the island runtime, which has not loaded yet at this point.
  //
  // Two kinds of interaction are handled. A click or a submit is HELD: the
  // event is prevented and queued so the island can hydrate and the action can
  // be reproduced against the same target. A pointerdown or a focusin is only
  // OBSERVED: it starts hydration early and native behavior proceeds, so
  // typing into a field or toggling a checkbox is never swallowed. The event
  // set here must match FARM_ISLAND_ACTIVATION_EVENTS. Every click is queued,
  // so two clicks on a counter count two once it hydrates. A repeated submit
  // of a form, or click on its submit button, is still prevented but queued
  // once, so a second submit never goes native ahead of the replay and the
  // form is not submitted twice.
  const selector = JSON.stringify(FARM_ISLAND_REPLAYABLE_SELECTOR);
  return `<script>(function(){if(window.__FARM_PREHYDRATION_CLICK_QUEUE__)return;var queue=[];window.__FARM_PREHYDRATION_CLICK_QUEUE__=queue;window.__FARM_HYDRATED__=false;document.documentElement.dataset.farmHydrated="false";function isModified(event){return !!(event.metaKey||event.altKey||event.ctrlKey||event.shiftKey)}function inHydrated(node){return !!(node&&node.closest&&node.closest('[data-farm-island-hydrated="true"]'))}function closestQueuedTarget(target){while(target&&target!==document.documentElement){if(target.matches&&target.matches(${selector}))return target;target=target.parentElement}return null}function announce(target,kind){document.dispatchEvent(new CustomEvent("farm:island-interaction",{detail:{target:target,kind:kind||null}}))}function submits(target,kind){return kind==="submit"||!!(target.form&&target.type==="submit")}function hold(event,target,kind){if(!(submits(target,kind)&&queue.some(function(item){return item.target===target}))){queue.push({target:target,kind:kind,createdAt:Date.now()});announce(target,kind)}event.preventDefault();event.stopImmediatePropagation()}document.addEventListener("click",function(event){if(window.__FARM_HYDRATED__)return;if(event.defaultPrevented||event.button!==0||isModified(event))return;var target=closestQueuedTarget(event.target);if(!target||target.closest&&target.closest("a[href]")||inHydrated(target))return;hold(event,target,"click")},true);document.addEventListener("submit",function(event){if(window.__FARM_HYDRATED__)return;if(event.defaultPrevented)return;var form=event.target;if(!form||form.nodeName!=="FORM"||inHydrated(form))return;hold(event,form,"submit")},true);function observe(event){if(window.__FARM_HYDRATED__)return;var target=event.target;if(!(target&&target.closest)||inHydrated(target))return;announce(target,null)}document.addEventListener("pointerdown",observe,true);document.addEventListener("focusin",observe,true);})();</script>`;
}
