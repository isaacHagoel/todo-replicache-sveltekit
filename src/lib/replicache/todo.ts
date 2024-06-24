// This file defines our Todo domain type in TypeScript, and a related helper
// function to get all Todos. You'd typically have one of these files for each
// domain object in your application.

import type { ReadTransaction } from 'replicache';

export type Todo = {
	id: string;
	text: string;
	completed: boolean;
	sort: number;
	updatedBy: string;
};

export type TodoUpdate = Partial<Todo> & Pick<Todo, 'id' | 'updatedBy'>;

export async function listTodos(tx: ReadTransaction) {
	return await tx.scan<Todo>({ prefix: 'todo/' }).values().toArray();
}
export async function getTodoById(tx: ReadTransaction, id: string) {
	return tx.get<Todo>(`todo/${id}`);
}
