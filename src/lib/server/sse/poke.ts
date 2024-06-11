export function getPokeBackend() {
	// The SSE impl has to keep process-wide state using the global object.
	// Otherwise the state is lost during hot reload in dev.
	const global = globalThis as unknown as {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		_pokeBackend: PokeBackend;
	};
	if (!global._pokeBackend) {
		global._pokeBackend = new PokeBackend();
	}
	return global._pokeBackend;
}

type Listener = () => void;
type ListenerMap = Map<string, Set<Listener>>;

// Implements the poke backend using server-sent events.
export class PokeBackend {
	private _listeners: ListenerMap;

	constructor() {
		this._listeners = new Map();
	}

	addListener(spaceID: string, listener: () => void) {
		let set = this._listeners.get(spaceID);
		if (!set) {
			set = new Set();
			this._listeners.set(spaceID, set);
		}
		set.add(listener);
		return () => this._removeListener(spaceID, listener);
	}

	poke(spaceID: string) {
		const set = this._listeners.get(spaceID);
		if (!set) {
			return;
		}
		for (const listener of set) {
			try {
				listener();
			} catch (e) {
				console.error(e);
			}
		}
	}

	private _removeListener(spaceID: string, listener: () => void) {
		const set = this._listeners.get(spaceID);
		if (!set) {
			return;
		}
		set.delete(listener);
		if (set.size === 0) {
			this._listeners.delete(spaceID);
		}
	}
}
