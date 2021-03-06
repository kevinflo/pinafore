import { dbPromise, getDatabase } from './databaseLifecycle'
import { scheduleIdleTask } from '../_utils/scheduleIdleTask'
import {
  ACCOUNTS_STORE,
  NOTIFICATION_TIMELINES_STORE,
  NOTIFICATIONS_STORE,
  PINNED_STATUSES_STORE,
  RELATIONSHIPS_STORE,
  STATUS_TIMELINES_STORE,
  STATUSES_STORE,
  THREADS_STORE,
  TIMESTAMP
} from './constants'
import debounce from 'lodash-es/debounce'
import { store } from '../_store/store'
import { mark, stop } from '../_utils/marks'
import { deleteAll } from './utils'
import { createPinnedStatusKeyRange, createThreadKeyRange } from './keys'

const BATCH_SIZE = 20
const TIME_AGO = 14 * 24 * 60 * 60 * 1000 // two weeks ago
const DELAY = 5 * 60 * 1000               // five minutes

function batchedGetAll (callGetAll, callback) {
  function nextBatch () {
    callGetAll().onsuccess = function (e) {
      let results = e.target.result
      callback(results)
      if (results.length) {
        nextBatch()
      }
    }
  }
  nextBatch()
}

function cleanupStatuses (statusesStore, statusTimelinesStore, threadsStore, cutoff) {
  batchedGetAll(
    () => statusesStore.index(TIMESTAMP).getAllKeys(IDBKeyRange.upperBound(cutoff), BATCH_SIZE),
    results => {
      results.forEach(statusId => {
        statusesStore.delete(statusId)
        deleteAll(
          statusTimelinesStore,
          statusTimelinesStore.index('statusId'),
          IDBKeyRange.only(statusId)
        )
        deleteAll(
          threadsStore,
          threadsStore,
          createThreadKeyRange(statusId)
        )
      })
    }
  )
}

function cleanupNotifications (notificationsStore, notificationTimelinesStore, cutoff) {
  batchedGetAll(
    () => notificationsStore.index(TIMESTAMP).getAllKeys(IDBKeyRange.upperBound(cutoff), BATCH_SIZE),
    results => {
      results.forEach(notificationId => {
        notificationsStore.delete(notificationId)
        deleteAll(
          notificationTimelinesStore,
          notificationTimelinesStore.index('notificationId'),
          IDBKeyRange.only(notificationId)
        )
      })
    }
  )
}

function cleanupAccounts (accountsStore, pinnedStatusesStore, cutoff) {
  batchedGetAll(
    () => accountsStore.index(TIMESTAMP).getAllKeys(IDBKeyRange.upperBound(cutoff), BATCH_SIZE),
    results => {
      results.forEach(accountId => {
        accountsStore.delete(accountId)
        deleteAll(
          pinnedStatusesStore,
          pinnedStatusesStore,
          createPinnedStatusKeyRange(accountId)
        )
      })
    }
  )
}

function cleanupRelationships (relationshipsStore, cutoff) {
  batchedGetAll(
    () => relationshipsStore.index(TIMESTAMP).getAllKeys(IDBKeyRange.upperBound(cutoff), BATCH_SIZE),
    results => {
      results.forEach(relationshipId => {
        relationshipsStore.delete(relationshipId)
      })
    }
  )
}

async function cleanup (instanceName) {
  console.log('cleanup', instanceName)
  mark(`cleanup:${instanceName}`)
  let db = await getDatabase(instanceName)
  let storeNames = [
    STATUSES_STORE,
    STATUS_TIMELINES_STORE,
    NOTIFICATIONS_STORE,
    NOTIFICATION_TIMELINES_STORE,
    ACCOUNTS_STORE,
    RELATIONSHIPS_STORE,
    THREADS_STORE,
    PINNED_STATUSES_STORE
  ]
  await dbPromise(db, storeNames, 'readwrite', (stores) => {
    let [
      statusesStore,
      statusTimelinesStore,
      notificationsStore,
      notificationTimelinesStore,
      accountsStore,
      relationshipsStore,
      threadsStore,
      pinnedStatusesStore
    ] = stores

    let cutoff = Date.now() - TIME_AGO

    cleanupStatuses(statusesStore, statusTimelinesStore, threadsStore, cutoff)
    cleanupNotifications(notificationsStore, notificationTimelinesStore, cutoff)
    cleanupAccounts(accountsStore, pinnedStatusesStore, cutoff)
    cleanupRelationships(relationshipsStore, cutoff)
  })
  stop(`cleanup:${instanceName}`)
}

function doCleanup (instanceName) {
  scheduleIdleTask(() => cleanup(instanceName))
}

function scheduledCleanup () {
  console.log('scheduledCleanup')
  let instances = store.get('loggedInInstancesInOrder')
  for (let instance of instances) {
    doCleanup(instance)
  }
}

export const scheduleCleanup = debounce(() => scheduleIdleTask(scheduledCleanup), DELAY)
