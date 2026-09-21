import { http } from './request'
import type { UserVO, UserCreditsVO, UpdateUserRequest } from './types'

// 用户 API
const BASE_URL = '/api/v1/users'

/**
 * 获取当前用户信息
 */
export function getCurrentUser(): Promise<UserVO> {
  return http.get<UserVO>(`${BASE_URL}/me`)
}

/**
 * 更新用户信息
 */
export function updateUser(data: UpdateUserRequest): Promise<void> {
  return http.put<void>(`${BASE_URL}/me`, data)
}

/**
 * 获取用户算力余额
 */
export function getUserCredits(): Promise<UserCreditsVO> {
  return http.get<UserCreditsVO>(`${BASE_URL}/me/credits`)
}