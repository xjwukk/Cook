import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createUserDataRepository, createUserRepository, openDatabase } from '../src/db.mjs'
import { isValidUserData } from '../src/user-data.mjs'

const kitchen = {
  ingredients: [{ name: '番茄', time: 1 }],
  ingredientRemovals: [{ name: '鸡蛋', time: 2 }],
  tools: [],
  toolRemovals: [],
  pantry: [],
  pantryRemovals: [{ name: '盐', time: 3 }],
  initialized: true,
}

describe('kitchen sync validation and storage', () => {
  it('accepts legacy documents and preserves all new fields for the correct account', () => {
    assert.equal(isValidUserData({ favorites: [], histories: [] }), true)
    const data = { favorites: [], kitchen, futureExtension: { enabled: true } }
    assert.equal(isValidUserData(data), true)
    const db = openDatabase(':memory:')
    try {
      const users = createUserRepository(db)
      const a = users.create('a', 'hash')
      const b = users.create('b', 'hash')
      const repository = createUserDataRepository(db)
      repository.put(a.id, data)
      assert.deepEqual(repository.get(a.id).data, data)
      assert.equal(repository.get(b.id), null)
    }
    finally {
      db.close()
    }
  })

  it('rejects invalid kitchen sets and timestamp/name types rather than silently stripping them', () => {
    for (const invalid of [null, [], {}, { ...kitchen, initialized: 1 }, { ...kitchen, tools: ['锅'] }, { ...kitchen, pantry: [{ name: '盐', time: -1 }] }, { ...kitchen, pantry: [{ name: '', time: 1 }] }])
      assert.equal(isValidUserData({ kitchen: invalid }), false)
  })
})
