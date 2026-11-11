import { createSharedComposable } from '@vueuse/core'

export interface AccountUser {
  id: number
  username: string
  role?: 'admin' | 'user'
}

type AccountStatus = 'checking' | 'anonymous' | 'authenticated'

interface AccountState {
  user: AccountUser | null
  status: AccountStatus
  errorMessage: string
  busy: boolean
}

/**
 * 自托管账号：登录态由服务端的 HttpOnly 会话 Cookie 维护，
 * 前端只保存最小用户信息，不接触密码哈希或令牌。
 */
async function request<T>(path: string, init?: RequestInit): Promise<{ data?: T, error?: string, status: number }> {
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
    if (response.status === 204)
      return { status: 204 }
    const body = await response.json().catch(() => ({}))
    if (!response.ok)
      return { status: response.status, error: body?.error || `请求失败（${response.status}）` }
    return { status: response.status, data: body as T }
  }
  catch {
    return { status: 0, error: '无法连接服务器，请检查网络或稍后重试' }
  }
}

export const useAccount = createSharedComposable(() => {
  const state = reactive<AccountState>({
    user: null,
    status: 'checking',
    errorMessage: '',
    busy: false,
  })

  async function refresh(): Promise<void> {
    const result = await request<{ user: AccountUser }>('/api/auth/me')
    if (result.data?.user) {
      state.user = result.data.user
      state.status = 'authenticated'
    }
    else {
      state.user = null
      state.status = 'anonymous'
    }
  }

  async function submit(path: '/api/auth/login' | '/api/auth/register', username: string, password: string, inviteCode = ''): Promise<boolean> {
    state.busy = true
    state.errorMessage = ''
    const result = await request<{ user: AccountUser }>(path, {
      method: 'POST',
      body: JSON.stringify({ username, password, inviteCode }),
    })
    state.busy = false
    if (result.data?.user) {
      state.user = result.data.user
      state.status = 'authenticated'
      return true
    }
    state.errorMessage = result.error || '登录失败'
    return false
  }

  const login = (username: string, password: string) => submit('/api/auth/login', username, password)
  const register = (username: string, password: string, inviteCode: string) => submit('/api/auth/register', username, password, inviteCode)

  async function logout(): Promise<void> {
    state.busy = true
    await request('/api/auth/logout', { method: 'POST' })
    state.busy = false
    state.user = null
    state.status = 'anonymous'
  }

  function clearError(): void {
    state.errorMessage = ''
  }

  return {
    state,
    user: computed(() => state.user),
    isAuthenticated: computed(() => state.status === 'authenticated'),
    errorMessage: computed(() => state.errorMessage),
    busy: computed(() => state.busy),
    refresh,
    login,
    register,
    logout,
    clearError,
  }
})
