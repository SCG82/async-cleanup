import process from 'node:process'

/** Signals that can be listened for. */
type ListenedSignals = typeof AsyncCleanup.listenedSignals[number]
/** Signals that can terminate the process. */
export type ExitSignal = ListenedSignals | 'SIGKILL' | 'SIGQUIT' | 'SIGSTOP'
/** A function (possibly asynchronous) invoked before the process exits. */
export type CleanupListener = () => void | Promise<void>

export class AsyncCleanup {
    cleanupListeners?: Set<CleanupListener> | undefined
    /**
     * Listenable signals that terminate the process by default
     * (except SIGQUIT, which generates a core dump and should not trigger cleanup)
     * See https://nodejs.org/api/process.html#signal-events
     */
    static listenedSignals = [
        'SIGBREAK', // Ctrl-Break on Windows
        'SIGHUP', // Parent terminal closed
        'SIGINT', // Terminal interrupt, usually by Ctrl-C
        'SIGTERM', // Graceful termination
        'SIGUSR2', // Used by Nodemon
    ] as const

    constructor() {
        this.add = this.add.bind(this)
        this.remove = this.remove.bind(this)
        this.executeCleanupListeners = this.executeCleanupListeners.bind(this)
        this.exitAfterCleanup = this.exitAfterCleanup.bind(this)
        this.killAfterCleanup = this.killAfterCleanup.bind(this)
        this.beforeExitListener = this.beforeExitListener.bind(this)
        this.uncaughtExceptionListener =
            this.uncaughtExceptionListener.bind(this)
        this.signalListener = this.signalListener.bind(this)
        this.pm2ClusterShutdownListener =
            this.pm2ClusterShutdownListener.bind(this)
        this.installExitListeners = this.installExitListeners.bind(this)
        this.uninstallExitListeners = this.uninstallExitListeners.bind(this)
    }

    /** Registers a new cleanup listener. Adding the same listener more than once has no effect. */
    add(listener: CleanupListener): () => void {
        // Install exit listeners on initial cleanup listener
        if (!this.cleanupListeners) {
            this.installExitListeners()
            this.cleanupListeners = new Set<CleanupListener>()
        }
        this.cleanupListeners.add(listener)
        return this.remove.bind(this, listener)
    }

    /** Removes an existing cleanup listener, and returns whether the listener was registered. */
    remove(listener: CleanupListener): boolean {
        if (!this.cleanupListeners) return false
        const wasRegistered = this.cleanupListeners.delete(listener)
        if (this.cleanupListeners.size === 0) {
            this.uninstallExitListeners()
            delete this.cleanupListeners
        }
        return wasRegistered
    }

    async executeCleanupListeners(): Promise<void> {
        if (!this.cleanupListeners) return

        // Remove exit listeners to restore normal event handling
        this.uninstallExitListeners()

        // Clear cleanup listeners to reset state for testing
        const listeners = this.cleanupListeners
        delete this.cleanupListeners

        // Call listeners in order added with async listeners running concurrently
        const promises: Promise<void>[] = []
        for (const listener of listeners) {
            try {
                const promise = listener()
                if (promise instanceof Promise) {
                    promises.push(promise)
                }
            } catch (err) {
                console.error('Uncaught exception during cleanup', err)
            }
        }

        // Wait for all listeners to complete and log any rejections
        const results = await Promise.allSettled(promises)
        for (const result of results) {
            if (result.status === 'rejected') {
                console.error(
                    'Unhandled rejection during cleanup',
                    result.reason,
                )
            }
        }
    }

    /** Executes all cleanup listeners and then exits the process. Call this instead of `process.exit` to ensure all listeners are fully executed. */
    async exitAfterCleanup(code = 0): Promise<never> {
        await this.executeCleanupListeners()
        process.exit(code)
    }

    /** Executes all cleanup listeners and then kills the process with the given signal. */
    async killAfterCleanup(signal: ExitSignal): Promise<void> {
        await this.executeCleanupListeners()
        process.kill(process.pid, signal)
    }

    beforeExitListener(code: number): void {
        console.log(`Exiting with code ${code} due to empty event loop`)
        void this.exitAfterCleanup(code)
    }

    uncaughtExceptionListener(error: Error): void {
        console.error('Exiting with code 1 due to uncaught exception', error)
        void this.exitAfterCleanup(1)
    }

    signalListener(signal: ExitSignal): void {
        console.log(`Exiting due to signal ${signal}`)
        void this.killAfterCleanup(signal)
    }

    pm2ClusterShutdownListener(message: string): void {
        if (message !== 'shutdown') return
        console.log('Exiting due to PM2 cluster shutdown')
        void this.killAfterCleanup('SIGTERM')
    }

    installExitListeners(): void {
        process.on('beforeExit', this.beforeExitListener.bind(this))
        process.on('message', this.pm2ClusterShutdownListener.bind(this))
        process.on(
            'uncaughtException',
            this.uncaughtExceptionListener.bind(this),
        )
        AsyncCleanup.listenedSignals.forEach((signal) =>
            process.on(signal, this.signalListener.bind(this)),
        )
    }

    uninstallExitListeners(): void {
        process.removeListener('beforeExit', this.beforeExitListener.bind(this))
        process.removeListener(
            'message',
            this.pm2ClusterShutdownListener.bind(this),
        )
        process.removeListener(
            'uncaughtException',
            this.uncaughtExceptionListener.bind(this),
        )
        AsyncCleanup.listenedSignals.forEach((signal) =>
            process.removeListener(signal, this.signalListener.bind(this)),
        )
    }
}
