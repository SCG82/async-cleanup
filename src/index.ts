import { AsyncCleanup } from './AsyncCleanup'
export type { ExitSignal, CleanupListener } from './AsyncCleanup'

const asyncCleanup = new AsyncCleanup()

/** Registers a new cleanup listener. Adding the same listener more than once has no effect. */
export const addCleanupListener = asyncCleanup.add.bind(asyncCleanup)

/** Removes an existing cleanup listener, and returns whether the listener was registered. */
export const removeCleanupListener = asyncCleanup.remove.bind(asyncCleanup)

/** Executes all cleanup listeners and then exits the process. Call this instead of `process.exit` to ensure all listeners are fully executed. */
export const exitAfterCleanup = asyncCleanup.exitAfterCleanup.bind(asyncCleanup)

/** Executes all cleanup listeners and then kills the process with the given signal. */
export const killAfterCleanup = asyncCleanup.killAfterCleanup.bind(asyncCleanup)
