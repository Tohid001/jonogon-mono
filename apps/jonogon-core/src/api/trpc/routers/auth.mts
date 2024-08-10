import {publicProcedure, router} from '../index.mjs';
import {protectedProcedure} from '../middleware/protected.mjs';
import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {hmac} from '../../../lib/crypto/hmac.mjs';
import {env} from '../../../env.mjs';
import {generateSalt} from '../../../lib/crypto/salt.mjs';
import {generateIV} from '../../../lib/crypto/iv.mjs';
import {deriveKey} from '../../../lib/crypto/keys.mjs';
import {encrypt} from '../../../lib/crypto/encryption.mjs';
import {returnOf, scope} from 'scope-utilities';
import jwt from 'jsonwebtoken';
import {hash} from 'hasha';
import {pick} from 'es-toolkit';

export const authRouter = router({
    requestOTP: publicProcedure
        .input(
            z.object({
                phoneNumber: z.string().regex(/^\+8801[0-9]{9}$/g),
            }),
        )
        .mutation(async ({input, ctx}) => {
            const otp =
                env.NODE_ENV === 'development' &&
                input.phoneNumber === '+8801111111111'
                    ? '1111'
                    : Math.round(Math.random() * 9_999)
                          .toString()
                          .padStart(4, '0');

            const numberHash = await hmac(
                input.phoneNumber,
                env.COMMON_HMAC_SECRET,
            );

            const numberOfAttempts = (await ctx.services.redisConnection.eval(
                // this is lua code
                `
                    local current
                    current = redis.call("incr", KEYS[1])
                    
                    -- only run the expire command on first run
                    if current == 1 then
                        -- expire the key after 1 hour
                        redis.call("expire", KEYS[1], 3600)
                    end
                    
                    return current
                `,
                1,
                `otp:${numberHash}:otp-requests`,
            )) as number;

            if (numberOfAttempts > 5) {
                throw new TRPCError({
                    code: 'TOO_MANY_REQUESTS',
                    message:
                        'You can only request 5 OTPs for a number in one hour',
                });
            }

            const otpHash = await hmac(otp, env.COMMON_HMAC_SECRET);

            await ctx.services.redisConnection.setex(
                `otp:${numberHash}`,
                300, // expire in 5 minutes
                otpHash,
            );

            await ctx.services.smsService.sendSMS(
                input.phoneNumber,
                `Your Jonogon Login OTP is ${otp}`,
            );

            return {
                input,
                message: `otp-sent` as const,
            };
        }),
    createToken: publicProcedure
        .input(
            z.object({
                phoneNumber: z.string().regex(/^\+8801[0-9]{9}$/g),
                otp: z.string().regex(/^[0-9]{4}$/g),
            }),
        )
        .mutation(async ({input, ctx}) => {
            const numberHash = await hmac(
                input.phoneNumber,
                env.COMMON_HMAC_SECRET,
            );

            const storedOTPHash = await ctx.services.redisConnection.get(
                `otp:${numberHash}`,
            );

            const otpHash = await hmac(input.otp, env.COMMON_HMAC_SECRET);

            if (storedOTPHash !== otpHash) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'invalid-otp' as const,
                });
            }

            const user = await scope(
                await ctx.services.postgresQueryBuilder
                    .selectFrom('users')
                    .select(['id', 'name', 'picture', 'is_mod', 'is_admin'])
                    .where('phone_number_hmac', '=', numberHash)
                    .executeTakeFirst(),
            ).let(async (user) => {
                return (
                    user ??
                    (await returnOf(async () => {
                        // we're kinda serious about not storing
                        // the password in plain text.

                        const salt = generateSalt();
                        const iv = generateIV();

                        const key = await deriveKey(
                            env.COMMON_ENCRYPTION_SECRET,
                            salt,
                        );

                        const encryptedPhoneNumber = encrypt(
                            key,
                            iv,
                            input.phoneNumber,
                        );

                        const result = await ctx.services.postgresQueryBuilder
                            .insertInto('users')
                            .values({
                                phone_number_hmac: numberHash,
                                encrypted_phone_number: encryptedPhoneNumber,
                                phone_number_encryption_key_salt: salt,
                                phone_number_encryption_iv:
                                    iv.toString('base64'),
                                updated_at: new Date(),
                            })
                            .returning([
                                'id',
                                'name',
                                'picture',
                                'is_mod',
                                'is_admin',
                            ])
                            .executeTakeFirst();

                        if (!result) {
                            throw new Error('error creating user');
                        }

                        return result;
                    }))
                );
            });

            const accessToken = jwt.sign(
                {
                    sub: user.id,
                    exp: Math.ceil(Date.now() / 1000) + 1 * 60 * 60, // one hour

                    is_adm: user.is_admin,
                    is_mod: user.is_mod,
                },
                env.COMMON_HMAC_SECRET,
            );

            const refreshToken = jwt.sign(
                {
                    sub: user.id,

                    nbf: Math.ceil(Date.now() / 1000) + 1 * 55 * 60, // not valid until 5 minutes before access_token expiry.
                    exp: Math.ceil(Date.now() / 1000) + 60 * 24 * 60 * 60, // 60 days

                    is_adm: user.is_admin,
                    is_mod: user.is_mod,
                },
                env.COMMON_HMAC_SECRET,
            );

            return {
                access_token: accessToken,
                access_token_validity: 1 * 60 * 60,

                refresh_token: refreshToken,
                refresh_token_validity: 60 * 24 * 60 * 60,

                user: pick(user, ['id', 'name', 'picture']), // to ensure we don't accidentally leak
            };
        }),
    refreshToken: publicProcedure
        .input(z.object({refreshToken: z.string()}))
        .mutation(async ({input, ctx}) => {
            const tokenClaims = await returnOf(async () => {
                const decodedToken: any = jwt.verify(
                    input.refreshToken,
                    env.COMMON_HMAC_SECRET,
                    {
                        ignoreNotBefore: env.NODE_ENV === 'development',
                    },
                );

                if (!decodedToken) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'invalid refresh token',
                    });
                }

                if (!decodedToken?.sub) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: 'subject not present on token',
                    });
                }

                return decodedToken;
            });

            const refreshTokenDigest = await hash(input.refreshToken, {
                algorithm: 'sha256',
                encoding: 'hex',
            });

            const isInvalidated = !!(await ctx.services.redisConnection.exists(
                `refresh-token:${refreshTokenDigest}:is-invalidated`,
            ));

            if (isInvalidated) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'refresh token has been invalidated',
                });
            }

            const accessToken = jwt.sign(
                {
                    sub: tokenClaims.sub,
                    exp: Math.ceil(Date.now() / 1000) + 1 * 60 * 60, // one hour,

                    is_adm: tokenClaims.is_admin,
                    is_mod: tokenClaims.is_mod,
                },
                env.COMMON_HMAC_SECRET,
            );

            const refreshToken = jwt.sign(
                {
                    sub: tokenClaims.sub,

                    nbf: Math.ceil(Date.now() / 1000) + 1 * 55 * 60, // not valid until 5 minutes before access_token expiry.
                    exp: Math.ceil(Date.now() / 1000) + 60 * 24 * 60 * 60, // 60 days

                    is_adm: tokenClaims.is_admin,
                    is_mod: tokenClaims.is_mod,
                },
                env.COMMON_HMAC_SECRET,
            );

            const expiresIn =
                (tokenClaims?.exp ?? Date.now() / 1000) - Date.now() / 1000;

            await ctx.services.redisConnection.setex(
                `refresh-token:${refreshTokenDigest}:is-invalidated`,
                Math.ceil(expiresIn + 60), // a minute after expiry
                '1',
            );

            return {
                access_token: accessToken,
                access_token_validity: 1 * 60 * 60,

                refresh_token: refreshToken,
                refresh_token_validity: 60 * 24 * 60 * 60,
            };
        }),
    invalidateRefreshToken: protectedProcedure
        .input(z.object({refreshToken: z.string()}))
        .mutation(async ({input, ctx}) => {
            // TODO: check if the refresh token is in fact the logged-in user's

            const refreshTokenDigest = await hash(input.refreshToken, {
                algorithm: 'sha256',
                encoding: 'hex',
            });

            // TODO: expire the redis key after the refresh token expires
            //       instead of 60 days from now

            await ctx.services.redisConnection.setex(
                `refresh-token:${refreshTokenDigest}:is-invalidated`,
                60 * 25 * 60 * 60, // 60 days from now (temporarily)
                '1',
            );
        }),
});
