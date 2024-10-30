import {ColumnDefinitions, MigrationBuilder} from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
    pgm.addColumns('petitions', {
        flagged_at: {
            type: 'timestamp',
            notNull: false, // Allow null for this column
        },
        flagged_reason: {
            type: 'text',
            notNull: false, // Allow null for this column
        },
    });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
    pgm.dropColumns('petitions', ['flagged_at', 'flagged_reason']);
}
