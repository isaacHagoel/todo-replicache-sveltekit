type ResRej = (value: unknown) => void

type Queueable = {
    operation: () => any,
    resolvers: { resolve: ResRej, reject: ResRej}
}

// we want to run async operations serially and in order (the promises will resolve in the same order they were queued)
// TODO - this could be optimised to execute in parallel but still resolve in the right order 
export function serialAsyncExecutor() {
    const _queue: Queueable[] = [];
    let isWorking = false;
    async function pullFromQueue() {
        isWorking = true;
        while (true) {
            const next = _queue.pop();
            if (next === undefined) break;

            const {operation, resolvers: {resolve, reject}} = next;
            try {
                const res = await operation();
                resolve(res);   
            } catch (e) {
                reject(e);
            }
        }
        isWorking = false;
    }
    return {
        execute(operation: () => any) {
            let resolve: ResRej, reject: ResRej;
            return new Promise((resolve, reject) => {
                _queue.push({operation, resolvers: {resolve, reject}});
                if (!isWorking) pullFromQueue();
            }); 
        }
    }
}
