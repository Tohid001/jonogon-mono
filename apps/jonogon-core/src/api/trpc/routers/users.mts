import {publicProcedure, router} from '../index.mjs';
import {z} from 'zod';
import {protectedProcedure} from '../middleware/protected.mjs';
import {TRPCError} from '@trpc/server';
import {deriveKey} from '../../../lib/crypto/keys.mjs';
import {env} from '../../../env.mjs';
import {decrypt} from '../../../lib/crypto/encryption.mjs';
import {pick} from 'es-toolkit';

export const userRouter = router({
    getSelf: protectedProcedure.query(async ({ctx}) => {
        const user = await ctx.services.postgresQueryBuilder
            .selectFrom('users')
            .select([
                'id',
                'name',
                'picture',
                'encrypted_phone_number',
                'phone_number_encryption_key_salt',
                'phone_number_encryption_iv',
            ])
            .where('id', '=', `${ctx.auth.user_id}`)
            .executeTakeFirst();

        if (!user) {
            throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'user not found',
            });
        }

        // TODO: discuss if we should even return the number
        //       we should probably opt for just returning the last 4 digits
        //       OR we should just rely on the frontend to store the number at login

        const salt = user.phone_number_encryption_key_salt;
        const iv = Buffer.from(user.phone_number_encryption_iv, 'base64');

        const key = await deriveKey(env.COMMON_ENCRYPTION_SECRET, salt);

        const decryptedPhoneNumber = decrypt(
            key,
            iv,
            user.encrypted_phone_number,
        );

        return {
            data: {
                ...pick(user, ['id', 'name']),
                picture_url: user.picture
                    ? await ctx.services.fileStorage.getFileURL(user.picture)
                    : null,
                phone: decryptedPhoneNumber,
                is_completed: user.name,
            },
            meta: {
                token: ctx.auth,
            },
        };
    }),
    updateSelf: protectedProcedure
        .input(
            z.object({
                name: z.string().min(3).max(128),
            }),
        )
        .mutation(async ({ctx, input}) => {
            const user = await ctx.services.postgresQueryBuilder
                .updateTable('users')
                .set({
                    name: input.name,
                })
                .where('id', '=', `${ctx.auth.user_id}`)
                .executeTakeFirst();

            if (!user) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'user not found',
                });
            }

            return {
                input,
                message: 'updated',
            };
        }),
    getAllUserNames: publicProcedure.query(async ({ctx}) => {
        const userNames = await ctx.services.postgresQueryBuilder
            .selectFrom('users')
            .select('users.name') // Select only user names
            .where('users.name', 'is not', null) // Exclude any null names
            .distinctOn('users.id') // Ensure unique users
            .execute();

        return userNames;
    }),
    getTotalNumberOfUsers: publicProcedure.query(async ({ctx}) => {
        const count = await ctx.services.postgresQueryBuilder
            .selectFrom('users')
            .select((eb) => eb.fn.count('id').as('count'))
            .executeTakeFirst();

        return {
            data: {
                count,
            },
        };
    }),
});
