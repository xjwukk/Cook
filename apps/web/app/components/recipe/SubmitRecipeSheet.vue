<script lang="ts" setup>
import type { CustomRecipe } from '~/composables/store/customRecipe'
import { buildPublishPreview, hasDroppedItems } from '~/utils/publishedRecipes'
import { yunleHaptic } from '~/utils/yunleHost'

const props = defineProps<{ recipe?: CustomRecipe }>()
const emit = defineEmits<{ submitted: [] }>()
const open = defineModel<boolean>('open', { required: true })
const { submit, submitting, errorMessage } = useRecipeSubmissions()
const done = ref(false)

const preview = computed(() => props.recipe ? buildPublishPreview(props.recipe) : undefined)
const dropped = computed(() => Boolean(preview.value && hasDroppedItems(preview.value)))

watch(open, (value) => {
  if (value)
    done.value = false
})

async function confirm(): Promise<void> {
  if (!props.recipe || !preview.value)
    return
  const ok = await submit(props.recipe, preview.value)
  if (ok) {
    done.value = true
    void yunleHaptic('success')
    emit('submitted')
  }
}
</script>

<template>
  <ion-modal v-model="open">
    <ion-header>
      <ion-toolbar>
        <ion-title>投稿到全量菜谱</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="open = false">
            关闭
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div v-if="preview" class="submit-sheet">
        <template v-if="done">
          <p class="submit-sheet-done" role="status">
            已提交，等管理员审核。通过后所有用户都能在菜谱库里看到这道菜。
          </p>
        </template>

        <template v-else>
          <p class="submit-sheet-hint">
            提交后由管理员审核。通过后会收录进全量菜谱，所有用户都能看到；你自己的「我的菜谱」里这一份仍然保留。
          </p>

          <section class="submit-sheet-section">
            <h3>菜名</h3>
            <p>{{ preview.name }}</p>
          </section>

          <section class="submit-sheet-section">
            <h3>收录的食材</h3>
            <p v-if="preview.stuff.length" class="submit-sheet-chips">
              <span v-for="name in preview.stuff" :key="name" class="submit-sheet-chip is-keep">{{ name }}</span>
            </p>
            <p v-else class="submit-sheet-warn">
              去掉这些食材后就没有可以匹配的食材了，请至少保留一样收录食材。
            </p>
          </section>

          <section v-if="preview.tools.length" class="submit-sheet-section">
            <h3>收录的厨具</h3>
            <p class="submit-sheet-chips">
              <span v-for="name in preview.tools" :key="name" class="submit-sheet-chip is-keep">{{ name }}</span>
            </p>
          </section>

          <section v-if="dropped" class="submit-sheet-section">
            <h3>会移除的内容</h3>
            <p v-if="preview.droppedCondiments.length" class="submit-sheet-drop">
              常备调料：<strong>{{ preview.droppedCondiments.join('、') }}</strong>
              —— 它们在「常备」里单独计算，不影响匹配。
            </p>
            <p v-if="preview.droppedUnknown.length" class="submit-sheet-drop">
              不在收录词典里的食材：<strong>{{ preview.droppedUnknown.join('、') }}</strong>
              —— 只有收录的食材才能参与匹配，你的菜谱里仍然保留着它们。
            </p>
            <p v-if="preview.droppedTools.length" class="submit-sheet-drop">
              不在厨具词典里的：<strong>{{ preview.droppedTools.join('、') }}</strong>
            </p>
          </section>

          <section v-if="preview.note" class="submit-sheet-section">
            <h3>步骤</h3>
            <p class="submit-sheet-note">
              {{ preview.note }}
            </p>
          </section>

          <p v-if="errorMessage" class="submit-sheet-error" role="alert">
            {{ errorMessage }}
          </p>

          <div class="submit-sheet-actions">
            <button
              type="button"
              class="cook-btn cook-btn--secondary"
              :disabled="submitting"
              @click="open = false"
            >
              取消
            </button>
            <button
              type="button"
              class="cook-btn cook-btn--primary"
              :disabled="submitting || preview.blocked"
              :aria-busy="submitting"
              @click="confirm"
            >
              <ion-spinner v-if="submitting" class="cook-btn__spinner" name="crescent" />
              <span class="cook-btn__label">{{ submitting ? '提交中' : '提交审核' }}</span>
            </button>
          </div>
        </template>
      </div>
    </ion-content>
  </ion-modal>
</template>

<style scoped>
.submit-sheet {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 20px 40px;
}
.submit-sheet-hint {
  margin: 0;
  color: var(--c-ink-2);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
.submit-sheet-done {
  margin: 0;
  color: var(--c-herb);
  font-size: var(--fs-base);
  line-height: 1.7;
}
.submit-sheet-section h3 {
  margin: 0 0 6px;
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.submit-sheet-section p {
  margin: 0;
  color: var(--c-ink);
  font-size: var(--fs-base);
  line-height: 1.7;
}
.submit-sheet-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.submit-sheet-chip {
  padding: 2px 10px;
  border-radius: var(--r-pill);
  font-size: var(--fs-sm);
}
.submit-sheet-chip.is-keep {
  background: var(--c-paper-alt);
  color: var(--c-ink-2);
}
.submit-sheet-drop {
  color: var(--c-warn) !important;
  font-size: var(--fs-sm) !important;
}
.submit-sheet-warn {
  color: var(--c-warn) !important;
}
.submit-sheet-note {
  white-space: pre-wrap;
  color: var(--c-ink-2) !important;
}
.submit-sheet-error {
  margin: 0;
  color: var(--c-alert);
  font-size: var(--fs-sm);
}
.submit-sheet-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
.submit-sheet-actions .cook-btn {
  flex: 1;
}
</style>
