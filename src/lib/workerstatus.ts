// What the sidebar says about the worker(s), from their heartbeats.
//
// Each running worker writes `app_settings` / `worker_<role>` every 15 s
// (worker/heartbeat.mjs). A setup without a NAS runs one `all` worker and gets
// one dot; a split setup runs a `local` worker on the PC and a `nas` one and
// gets two, PC left, NAS right. Which it is follows from the newest heartbeat
// seen, so switching setups needs no setting. When the NAS worker is down the
// PC one covers its work, and its dot says so in a colour of its own.

export type WorkerRole = 'all' | 'nas' | 'local';

export interface WorkerTask {
	text: string;
	/** For a release the worker is holding until its slot. */
	until?: string;
}

export interface WorkerBeat {
	role: WorkerRole;
	run?: string;
	pid?: number;
	host?: string;
	startedAt?: string;
	beatAt: string;
	covering?: boolean;
	waiting?: boolean;
	doing?: WorkerTask[];
	stoppedAt?: string;
}

export type WorkerBeats = Partial<Record<WorkerRole, WorkerBeat | null>>;

export type DotState = 'up' | 'down' | 'covering';

export interface WorkerDot {
	role: WorkerRole;
	state: DotState;
	title: string;
}

export interface WorkerView {
	dots: WorkerDot[];
	lines: WorkerTask[];
}

/** Mirrors STALE_MS in worker/roles.mjs: three missed beats and it is down. */
export const STALE_MS = 45_000;

const NAMES: Record<WorkerRole, string> = { all: 'Worker', local: 'PC worker', nas: 'NAS worker' };

function time(iso: string | undefined): number {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isFinite(t) ? t : NaN;
}

export function isAlive(beat: WorkerBeat | null | undefined, now: number): boolean {
	if (!beat || beat.stoppedAt) return false;
	const at = time(beat.beatAt);
	return Number.isFinite(at) && now - at < STALE_MS;
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} h ago`;
	return `${Math.floor(hours / 24)} d ago`;
}

function lastSeen(beat: WorkerBeat): number {
	return Math.max(time(beat.beatAt), time(beat.stoppedAt)) || time(beat.beatAt);
}

function dot(role: WorkerRole, beat: WorkerBeat | null | undefined, now: number): WorkerDot {
	const name = NAMES[role];
	const on = beat?.host ? ` on ${beat.host}` : '';
	if (!beat) return { role, state: 'down', title: `${name}: never seen` };
	if (!isAlive(beat, now)) {
		return { role, state: 'down', title: `${name}${on}: not running, last seen ${ago(now - lastSeen(beat))}` };
	}
	if (role === 'local' && beat.covering) {
		return { role, state: 'covering', title: `${name}${on}: running, and doing the NAS worker's work too` };
	}
	if (role === 'nas' && beat.waiting) {
		return { role, state: 'up', title: `${name}${on}: running, waiting for the PC worker to hand over` };
	}
	return { role, state: 'up', title: `${name}${on}: running` };
}

export function workerView(beats: WorkerBeats, now: number): WorkerView {
	const present = (Object.values(beats).filter(Boolean) as WorkerBeat[]).sort(
		(a, b) => lastSeen(b) - lastSeen(a)
	);
	const newest = present[0];
	const split = Boolean(newest && newest.role !== 'all');

	const roles: WorkerRole[] = split ? ['local', 'nas'] : ['all'];
	const dots = roles.map((role) => dot(role, beats[role], now));

	const alive = roles.map((role) => beats[role]).filter((b): b is WorkerBeat => isAlive(b, now));
	if (alive.length === 0) {
		const text = newest ? `Not running · last seen ${ago(now - lastSeen(newest))}` : 'Not running';
		return { dots, lines: [{ text }] };
	}

	const lines: WorkerTask[] = [];
	const local = beats.local;
	const nas = beats.nas;
	if (split && isAlive(local, now) && local?.covering) lines.push({ text: 'PC covering for the NAS' });
	if (split && isAlive(nas, now) && nas?.waiting) lines.push({ text: 'NAS waiting for the PC to hand over' });
	for (const beat of alive) for (const task of beat.doing ?? []) lines.push(task);
	if (lines.length === 0) lines.push({ text: 'Idle' });
	return { dots, lines };
}
