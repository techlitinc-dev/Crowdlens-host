<script setup lang="ts">
/** Members & roles (design.md §5.6): invite, change role, remove. Revocation
 *  takes effect immediately because membership is re-verified per request. */
interface MemberRow {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

const { api } = useApi();
const { workspaceId, ready, session } = useWorkspaceContext();
const members = ref<MemberRow[]>([]);
const error = ref("");
const notice = ref("");
const inviteEmail = ref("");
const inviteRole = ref("viewer");

const canManage = computed(() => ["owner", "admin"].includes(
  session.value?.workspaces.find((w) => w.id === workspaceId.value)?.role ?? "",
));

async function load() {
  try {
    const result = await api<{ members: MemberRow[] }>("GET", `/v1/workspaces/${workspaceId.value}/members`, { workspaceId: workspaceId.value });
    members.value = result.members;
  } catch (err) {
    error.value = (err as Error).message;
  }
}

watch(ready, (isReady) => {
  if (isReady) void load();
});
onMounted(() => {
  if (ready.value) void load();
});

async function invite() {
  error.value = "";
  notice.value = "";
  try {
    await api("POST", `/v1/workspaces/${workspaceId.value}/members`, {
      workspaceId: workspaceId.value,
      body: { email: inviteEmail.value.trim(), role: inviteRole.value },
    });
    notice.value = "Member added. They appear immediately — no invitation email in local identity mode.";
    inviteEmail.value = "";
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function changeRole(userId: string, role: string) {
  error.value = "";
  try {
    await api("PATCH", `/v1/workspaces/${workspaceId.value}/members/${userId}`, {
      workspaceId: workspaceId.value,
      body: { role },
    });
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function removeMember(userId: string) {
  error.value = "";
  try {
    await api("DELETE", `/v1/workspaces/${workspaceId.value}/members/${userId}`, { workspaceId: workspaceId.value });
    await load();
  } catch (err) {
    error.value = (err as Error).message;
  }
}
</script>

<template>
  <AppShell>
    <h1 class="page-title">Members</h1>
    <p class="panel-note">Roles: owner · admin · analyst · viewer · billing_admin. Changes take effect on the member's next request.</p>
    <p v-if="error" class="panel-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="panel-notice" role="status">{{ notice }}</p>

    <form v-if="canManage" class="surface invite" @submit.prevent="invite">
      <label>
        Email
        <input v-model="inviteEmail" type="email" required placeholder="teammate@example.com" />
      </label>
      <label>
        Role
        <select v-model="inviteRole">
          <option value="viewer">viewer</option>
          <option value="analyst">analyst</option>
          <option value="admin">admin</option>
          <option value="billing_admin">billing_admin</option>
        </select>
      </label>
      <button type="submit" class="panel-button">Add member</button>
    </form>

    <div class="surface table-scroll">
      <table class="table-plain">
        <thead>
          <tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col" /><th scope="col" /></tr>
        </thead>
        <tbody>
          <tr v-for="member in members" :key="member.user_id">
            <td>{{ member.email }}</td>
            <td>
              <select
                v-if="canManage && member.role !== 'owner'"
                :value="member.role"
                @change="changeRole(member.user_id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="viewer">viewer</option>
                <option value="analyst">analyst</option>
                <option value="admin">admin</option>
                <option value="billing_admin">billing_admin</option>
              </select>
              <span v-else>{{ member.role }}</span>
            </td>
            <td />
            <td>
              <button v-if="canManage && member.role !== 'owner'" type="button" class="remove" @click="removeMember(member.user_id)">
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </AppShell>
</template>

<style scoped>
.page-title {
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  font-weight: 600;
  margin: 0 0 var(--space-2);
}
.panel-note {
  color: var(--color-text-secondary);
}
.panel-error {
  color: var(--color-danger);
}
.panel-notice {
  color: var(--color-action);
}
.invite {
  display: flex;
  gap: var(--space-4);
  align-items: flex-end;
  flex-wrap: wrap;
  padding: var(--space-4);
  margin: var(--space-4) 0;
}
.panel-button {
  background: var(--color-bg-inset);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
}
.remove {
  background: transparent;
  border: 1px solid var(--color-danger);
  color: var(--color-danger);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-3);
  cursor: pointer;
}
.table-scroll {
  overflow-x: auto;
  padding: var(--space-2);
}
</style>
