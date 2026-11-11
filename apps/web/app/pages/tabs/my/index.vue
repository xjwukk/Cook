<script lang="ts" setup>
import dayjs from 'dayjs'
import { customRecipes } from '~/composables/store/customRecipe'

definePageMeta({
  alias: ['/my'],
})

const { user, isAuthenticated } = useAccount()
const { status: syncStatus, lastSyncedAt, errorMessage: syncErrorMessage, syncNow } = useAccountSync()

const syncText = computed(() => {
  switch (syncStatus.value) {
    case 'syncing':
      return '正在同步…'
    case 'synced':
      return `已同步 ${dayjs(lastSyncedAt.value).format('HH:mm')}`
    case 'error':
      return `${syncErrorMessage.value}，点击重试`
    default:
      return '等待同步'
  }
})

function handleSyncClick(): void {
  if (syncStatus.value === 'error')
    void syncNow()
}
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>我的</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">
            我的
          </ion-title>
        </ion-toolbar>
      </ion-header>

      <ion-list :inset="true">
        <ion-item v-if="isAuthenticated && user" class="my-account" lines="full">
          <ion-icon slot="start" class="my-account-placeholder" :icon="ioniconsPersonCircle" />
          <ion-label>
            <h2>{{ user.username }}</h2>
            <p>本服务器账号</p>
          </ion-label>
          <ion-note slot="end">
            <NuxtLink to="/account">
              退出
            </NuxtLink>
          </ion-note>
        </ion-item>

        <ion-item
          v-if="isAuthenticated"
          :button="syncStatus === 'error'"
          :detail="false"
          @click="handleSyncClick"
        >
          <span v-if="syncStatus === 'syncing'" slot="start" class="my-sync-spinner">
            <ion-spinner name="crescent" />
          </span>
          <CookListIcon
            v-else
            slot="start"
            :icon="syncStatus === 'error' ? ioniconsCloudOfflineOutline : ioniconsCloudDoneOutline"
            :color="syncStatus === 'error' ? '#a83226' : '#3f5d45'"
          />
          <ion-label>
            <h2>收藏和历史同步</h2>
            <p>{{ syncText }}</p>
          </ion-label>
        </ion-item>

        <ion-item v-else router-link="/account" :detail="true">
          <CookListIcon slot="start" :icon="ioniconsLogInOutline" color="#b84e27" />
          <ion-label>
            <h2>登录或注册</h2>
            <p>登录后收藏和历史可在多台设备间同步</p>
          </ion-label>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item router-link="/recipes/history">
          <CookListIcon slot="start" :icon="ioniconsTimeOutline" color="#7a5ea3" />
          <ion-label>历史记录</ion-label>
        </ion-item>
        <ion-item router-link="/recipes/favorites">
          <CookListIcon slot="start" :icon="ioniconsStarOutline" color="#d98324" />
          <ion-label>我的收藏</ion-label>
        </ion-item>
        <ion-item :button="true" router-link="/catalog">
          <CookListIcon slot="start" color="#4a7c59">
            <span class="i-mdi-carrot h-4.5 w-4.5" />
          </CookListIcon>
          <ion-label>食材和厨具</ion-label>
        </ion-item>
        <ion-item router-link="/recipes/mine">
          <CookListIcon slot="start" :icon="ioniconsBookOutline" color="#a2845e" />
          <ion-label>我的菜谱</ion-label>
          <ion-note v-if="customRecipes.length" slot="end">
            {{ customRecipes.length }}
          </ion-note>
        </ion-item>
      </ion-list>

      <ion-list :inset="true">
        <ion-item router-link="/settings">
          <CookListIcon slot="start" :icon="ioniconsSettingsOutline" color="#8a8078" />
          <ion-label>设置</ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.my-account {
  --padding-top: 6px;
  --padding-bottom: 6px;
}
.my-account-placeholder {
  font-size: 48px;
  margin-inline-end: 14px;
  color: var(--c-ink-3);
}
.my-account h2 {
  font-size: 20px;
  font-weight: 600;
}
.my-sync-spinner {
  display: inline-flex;
  justify-content: center;
  width: 29px;
  margin-inline-end: 14px;
}
</style>
