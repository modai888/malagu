import { inject, injectable, multiInject } from 'inversify';
import { ApplicationShell } from './application-shell';
import { FrontendApplicationStateService } from './frontend-application-state';
import { MaybePromise } from '../common/prioritizeable';
import { Logger } from '../common/logger';
import { parseCssTime } from './browser';

export const FrontendApplicationLifecycle = Symbol('FrontendApplicationLifecycle');
export interface FrontendApplicationLifecycle {

    /**
     * Called on application startup before configure is called.
     */
    initialize?(): void;

    /**
     * Called when the application is started. The application shell is not attached yet when this method runs.
     * Should return a promise if it runs asynchronously.
     */
    onStart?(app: FrontendApplication): MaybePromise<void>;

    /**
     * Called when an application is stopped or unloaded.
     *
     * Note that this is implemented using `window.unload` which doesn't allow any asynchronous code anymore.
     * I.e. this is the last tick.
     */
    onStop?(app: FrontendApplication): void;

}

@injectable()
export class EmptyFrontendApplicationLifecycle implements FrontendApplicationLifecycle {

    initialize() {
        // NOOP
    }

}

@injectable()
export class FrontendApplication {

    @multiInject(FrontendApplicationLifecycle)
    protected readonly lifecycles: FrontendApplicationLifecycle[];

    @inject(ApplicationShell)
    protected readonly _shell: ApplicationShell;

    @inject(FrontendApplicationStateService)
    protected readonly stateService: FrontendApplicationStateService;

    @inject(Logger)
    protected readonly logger: Logger;

    get shell(): ApplicationShell {
        return this._shell;
    }

    async start(): Promise<void> {
        await this.doStart();
        this.stateService.state = 'started';

        const host = await this.getHost();
        this._shell.attach(host);
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        this.stateService.state = 'attached_shell';

        await this.revealShell(host);
        this.registerEventListeners();
        this.stateService.state = 'ready';
    }

    /**
     * Return a promise to the host element to which the application shell is attached.
     */
    protected getHost(): Promise<HTMLElement> {
        if (document.body) {
            return Promise.resolve(document.body);
        }
        return new Promise<HTMLElement>(resolve =>
            window.addEventListener('load', () => resolve(document.body), { once: true })
        );
    }

    /**
     * Return an HTML element that indicates the startup phase, e.g. with an animation or a splash screen.
     */
    protected getStartupIndicator(host: HTMLElement): HTMLElement | undefined {
        const startupElements = host.getElementsByClassName('malagu-preload');
        return startupElements.length === 0 ? undefined : startupElements[0] as HTMLElement;
    }

    /**
     * Register global event listeners.
     */
    protected registerEventListeners(): void {
        window.addEventListener('unload', () => {
            this.stateService.state = 'closing_window';
            this.doStop();
        });
    }

    /**
     * If a startup indicator is present, it is first hidden with the `malagu-hidden` CSS class and then
     * removed after a while. The delay until removal is taken from the CSS transition duration.
     */
    protected revealShell(host: HTMLElement): Promise<void> {
        const startupElem = this.getStartupIndicator(host);
        if (startupElem) {
            return new Promise(resolve => {
                window.requestAnimationFrame(() => {
                    startupElem.classList.add('malagu-hidden');
                    const preloadStyle = window.getComputedStyle(startupElem);
                    const transitionDuration = parseCssTime(preloadStyle.transitionDuration, 0);
                    window.setTimeout(() => {
                        const parent = startupElem.parentElement;
                        if (parent) {
                            parent.removeChild(startupElem);
                        }
                        resolve();
                    }, transitionDuration);
                });
            });
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Initialize and start the frontend application.
     */
    protected async doStart(): Promise<void> {
        for (const lifecycle of this.lifecycles) {
            if (lifecycle.initialize) {
                try {
                    lifecycle.initialize();
                } catch (error) {
                    this.logger.error('Could not initialize lifecycle', error);
                }
            }
        }

       // TODO

        for (const lifecycle of this.lifecycles) {
            if (lifecycle.onStart) {
                try {
                    await this.measure(lifecycle.constructor.name + '.onStart',
                        () => lifecycle.onStart!(this)
                    );
                } catch (error) {
                    this.logger.error('Could not start lifecycle', error);
                }
            }
        }
    }

    /**
     * Stop the frontend application lifecycle. This is called when the window is unloaded.
     */
    protected doStop(): void {
        for (const lifecycle of this.lifecycles) {
            if (lifecycle.onStop) {
                try {
                    lifecycle.onStop(this);
                } catch (error) {
                    this.logger.error('Could not stop lifecycle', error);
                }
            }
        }
    }

    protected async measure<T>(name: string, fn: () => MaybePromise<T>): Promise<T> {
        const startMark = name + '-start';
        const endMark = name + '-end';
        performance.mark(startMark);
        const result = await fn();
        performance.mark(endMark);
        performance.measure(name, startMark, endMark);
        for (const item of performance.getEntriesByName(name)) {
            if (item.duration > 100) {
                console.warn(item.name + ' is slow, took: ' + item.duration + ' ms');
            } else {
                console.debug(item.name + ' took ' + item.duration + ' ms');
            }
        }
        performance.clearMeasures(name);
        return result;
    }

}
