/** Pure persisted state: restore these three fields with the game's validated save adapter. */
export class CameraTrap {
	phase: 'unplaced' | 'pending' | 'ready' | 'collected' = 'unplaced';
	placedAfterSerial = 0;
	constructor(
		readonly species: string,
		readonly ownerMission: string
	) {}
	place(completionSerial: number) {
		if (this.phase !== 'unplaced') return false;
		this.placedAfterSerial = completionSerial;
		this.phase = 'pending';
		return true;
	}
	/** Serial is the monotonically increasing mission-completion event sequence, not a mission index. */
	missionCompleted(id: string, serial: number) {
		if (this.phase === 'pending' && id !== this.ownerMission && serial > this.placedAfterSerial)
			this.phase = 'ready';
	}
	collect() {
		if (this.phase !== 'ready') return false;
		this.phase = 'collected';
		return true;
	}
}
