<script setup lang="ts">
// Global styles are imported here (rather than the css[] config) to keep
// them inside Vite's plugin pipeline; the tokens ship with @crowdlens/ui.
import "@crowdlens/ui/tokens.css";
import "~/assets/app.css";
</script>

<template>
  <NuxtPage />
</template>
