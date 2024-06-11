<script lang="ts">
	import { onMount } from 'svelte';
	import { Replicache } from 'replicache';
	import { nanoid } from 'nanoid';
	import { source } from 'sveltekit-sse';
	import { mutators, type M } from '$lib/replicache/mutators';
	import { page } from '$app/stores';
	import { listTodos } from '$lib/replicache/todo';
	import type { Todo } from '$lib/replicache/todo';

	import TodoMVC from '$lib/components/TodoMVC.svelte';

	const { spaceID } = $page.params;
	let replicacheInstance: Replicache<M>;
	let _list: Todo[] = [];
	let areAllChangesSaved = true;

	onMount(() => {
		replicacheInstance = initReplicache(spaceID);
		replicacheInstance.subscribe(listTodos, (data) => {
			_list = data;
			_list.sort((a: Todo, b: Todo) => a.sort - b.sort);
		});
		// Implements a Replicache poke using Server-Sent Events.
		// If a "poke" message is received, it will pull from the server.
		const connection = source(`/api/replicache/${spaceID}/poke`);
		const sseStore = connection.select('poke').transform(() => {
			console.log('poked! pulling fresh data for spaceID', spaceID);
			replicacheInstance.pull();
		});
		// The line below are kinda dumb, it prevents Svelte from removing this store at compile time (since it has not subscribers)
		const unsubscribe = sseStore.subscribe(() => {});

		// This allows us to show the user whether all their local data is saved on the server
		replicacheInstance.onSync = async () => {
			areAllChangesSaved = (await replicacheInstance.experimentalPendingMutations()).length === 0;
		};

		// cleanup
		return () => {
			replicacheInstance.close();
			unsubscribe();
			connection.close();
		};
	});

	function initReplicache(spaceID: string) {
		const licenseKey = import.meta.env.VITE_REPLICACHE_LICENSE_KEY;
		if (!licenseKey) {
			throw new Error('Missing VITE_REPLICACHE_LICENSE_KEY');
		}
		return new Replicache({
			licenseKey,
			pushURL: `/api/replicache/${spaceID}/push`,
			pullURL: `/api/replicache/${spaceID}/pull`,
			name: spaceID,
			mutators
		});
	}

	async function createTodo(text: string) {
		await replicacheInstance?.mutate.createTodo({
			id: nanoid(),
			text,
			completed: false
		});
	}
</script>

<p>{areAllChangesSaved ? 'All Data Saved' : 'Sync Pending'}</p>
<section class="todoapp">
	<TodoMVC
		items={_list}
		onCreateItem={createTodo}
		onDeleteItem={(id) => replicacheInstance.mutate.deleteTodo(id)}
		onUpdateItem={(updatedTodo) => replicacheInstance.mutate.updateTodo(updatedTodo)}
	/>
</section>
