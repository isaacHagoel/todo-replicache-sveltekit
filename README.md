# todo-replicache-sveltekit (with undo-redo)

Conflicts aware Undo/Redo in a multiplayer, offline-compatible TODO-MVC Demo.
![undo_basic_demo](https://github.com/isaacHagoel/todo-replicache-sveltekit/assets/20507787/55719699-55c0-43e0-bbfb-b6c60f067375)

[Play with the live app](https://todo-replicache-sveltekit-pr-2.onrender.com/)

This branch includes undo/ redo functionality that takes into account collaborative editing. When a conflict is detected, the conflicting entries are removed from the undo/ redo stacks.
It can deal with both sync and async operations and supports showing the user what's going to happen if they click undo or redo (hover over the buttons for a few seconds to see it).
It supports histroy-mode undo (if the user makes changes after some undo actions, none of the "future" changes are lost).

### Current gaps

- If the server rejects an update there will be a bad entry in the undo stack. I couldn't find a way to get Replicache to tell me it happened. It should be possible to work around it with some app specific logic, but I didn't implement it.
- The logic that detects whether a change that comes through in the subscription doesn't cover 100% of cases (see the relevant comment in the code). Good enough for the POC. Replicache would ideally provide that info as well.

### Possible enhancements / thoughts:

- Add event listeners on ctrl+z, shift+ctrl+z (I avoided it for the demo because the buttons ergonomics is part of what's being demonstrated).
- Max entries option to limit the size of the undo/redo stack.
- Can this conflict with the browser's built in undo/redo for text field? in this app it is not an issue but if extended it requires attention.
- Scroll the affected element into view before operating on it - maybe by done by passing a query selector to the undoManager
- If there was a text editor involved, how would that integrate (need to restore selection and avoid having two separate undo stacks)
- Is it possible to persist the undo/redo stack per user in Replicache so that it is shared across sessions? The challenge would be serialising the functions I think.
- If the undo manager ever becomes a library it will need a lot of unit/integration tests.
  //

## Original Readme (main branch)

This repository contains sample code for [Replicache](https://replicache.dev/). The example uses SvelteKit. The backend demonstrates implementations of `push`, `pull`, `poke`, `createSpace`, and `spaceExists` handlers, which are required for the Replicache sync protocol.

This is a port of [todo-wc](https://github.com/rocicorp/todo-wc), with a few minor additions. The frontend was ported from [svelte-todomvc](https://github.com/sveltejs/svelte-todomvc). It uses [svelte-sse](https://github.com/razshare/sveltekit-sse) for server-sent events and in-memory Postgres as the database (copied directly from todo-wc).

My goal in creating this was to learn more about both Replicache and SvelteKit, as porting a codebase forces one to understand it :). At the same time, I wanted to create something useful for others since the official examples on the Replicache website don't include a SvelteKit version. I chose the [example](https://doc.replicache.dev/examples/todo) with 'Per-Space Versioning' because it was the simplest one that also seemed practical (I couldn't think of a use case where global versioning would be desirable). Read more about it in [this blog post](https://dev.to/isaachagoel/are-sync-engines-the-future-of-web-applications-1bbi).

## 0. What's Being Demonstrated Here?

This looks and feels like the normal [TODO MVC](https://todomvc.com/) app but has the following additional properties:

1. It automatically syncs across tabs (even while offline).
2. It syncs across browsers and devices when online, including when going back online after being offline.
3. Despite writing every update to the backend, the user experience is snappy regardless of network speed and even when offline (thanks to Replicache's optimistic updates and its use of IndexedDB as a storage engine).
4. It has all the other properties of an app that uses Replicache, such as the ability to handle conflicts, rebasing, rollbacks, schema changes, etc.
5. The "syncing unit" here is a "space" (in our case, a list) - you'll see the spaceID in the URL. You can create multiple spaces, but when visiting one, only data related to it is synced back and forth with the backend. This means permissions can be granted per space. Every time you navigate to the root URL or try to go to a non-existing space, a new space is created (you have to be online for space creation to work). You can then copy the URL to another tab or window to see the space staying in sync.

### Minor Functionality Additions By Me (over the official example)

1. Added a primitive "sync pending/all changes saved" marker that's interesting to look at while throttling the network and when going into and out of offline mode.
2. Added a service worker (the one from the SvelteKit docs) to allow refreshing or navigating to an existing space in offline mode.

### Stuff I'd Like to Explore/Add But Haven't Yet

1. Undo/redo and version history (maybe using [Dolt](https://www.dolthub.com/)).
2. A conventional DB schema (e.g a table for items).
3. Space creation while offline.

### Other Thoughts

Notice that Replicache effectively plays the role a Svelte store would and has a very similar API from the frontend's point of view. Since Replicache holds all the data in memory (in addition to persisting it via IndexedDB), the app uses it directly without copying it into a Svelte store or state.

## 1. Setup

#### Get Your Replicache License Key (it's free)

```bash
$ npx replicache get-license
```

#### Set Your `VITE_REPLICACHE_LICENSE_KEY` Environment Variable, Either in .env or in Your Terminal:

```bash
$ export VITE_REPLICACHE_LICENSE_KEY="<your license key>"
```

#### Install

```bash
$ npm install
```

## 2. Start the Dev Server

```bash
$ npm run dev
```
