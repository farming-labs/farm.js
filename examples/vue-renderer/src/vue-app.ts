import { defineVueApp } from "@farm.js/vue";
import { createPinia } from "pinia";

// Farm calls this for every Vue app it creates: a fresh Pinia per server render, so requests
// never share store state, and one for the page in the browser.
export default defineVueApp((app) => {
  app.use(createPinia());
});
