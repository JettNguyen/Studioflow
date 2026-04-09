import passport from 'passport';
import { Profile, Strategy as GoogleStrategy, VerifyCallback } from 'passport-google-oauth20';
import { prisma } from '../lib/prisma.js';
import { env } from '../config.js';
import { mapAuthUser } from '../utils/mappers.js';

const googleScopes = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'];

passport.use(
  new GoogleStrategy(
    {
      clientID: env.googleClientId,
      clientSecret: env.googleClientSecret,
      callbackURL: env.googleRedirectUri,
      scope: googleScopes,
      passReqToCallback: false
    },
    async (
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        const email = profile.emails?.[0]?.value;
        const grantedScope = googleScopes.join(' ');

        if (!email) {
          return done(new Error('Google account did not return an email address.'));
        }

        let user = await prisma.user.findUnique({
          where: { email },
          include: {
            oauthAccounts: true
          }
        });

        if (!user) {
          user = await prisma.user.create({
            data: {
              email,
              name: profile.displayName || email.split('@')[0],
              avatarUrl: profile.photos?.[0]?.value,
              oauthAccounts: {
                create: {
                  provider: 'google',
                  providerAccountId: profile.id,
                  email,
                  accessToken,
                  refreshToken: refreshToken || null,
                  scope: grantedScope,
                  expiresAt: null
                }
              }
            },
            include: {
              oauthAccounts: true
            }
          });
        } else {
          await prisma.oAuthAccount.upsert({
            where: {
              provider_providerAccountId: {
                provider: 'google',
                providerAccountId: profile.id
              }
            },
            update: {
              email,
              accessToken,
              refreshToken: refreshToken || undefined,
              scope: grantedScope,
              expiresAt: null
            },
            create: {
              userId: user.id,
              provider: 'google',
              providerAccountId: profile.id,
              email,
              accessToken,
              refreshToken: refreshToken || null,
              scope: grantedScope,
              expiresAt: null
            }
          });

          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              name: user.name || profile.displayName || email.split('@')[0],
              avatarUrl: profile.photos?.[0]?.value ?? user.avatarUrl
            },
            include: {
              oauthAccounts: true
            }
          });
        }

        return done(null, mapAuthUser(user));
      } catch (error) {
        return done(error as Error);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        oauthAccounts: {
          where: { provider: 'google' }
        }
      }
    });

    done(null, user ? mapAuthUser(user) : false);
  } catch (error) {
    done(error as Error);
  }
});

export { googleScopes, passport };
