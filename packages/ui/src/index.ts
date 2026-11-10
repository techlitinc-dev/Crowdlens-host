import ClButton from "./components/ClButton.vue";
import ClChip from "./components/ClChip.vue";
import ClPanel from "./components/ClPanel.vue";

export { ClButton, ClChip, ClPanel };

export const uiPlugin = {
  install(app: { component: (name: string, comp: unknown) => void }) {
    app.component("ClButton", ClButton);
    app.component("ClChip", ClChip);
    app.component("ClPanel", ClPanel);
  },
};
