import Database from "better-sqlite3";

export const db = new Database("chromium_history.db", {
	//verbose: console.log
});
