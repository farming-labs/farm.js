import { defineStore } from "pinia";

export const useGreetingStore = defineStore("greeting", {
  state: () => ({ calls: 0 }),
});
