// Firebase Admin SDK to access Cloud Firestore
import {
  firestore as fs_extern,
  initializeApp,
  auth,
  messaging
} from "firebase-admin";

// Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers
import { firestore as fs_intern, https, logger } from "firebase-functions";

// Smarter cold boot firebase-admin
let is_admin_initialized = false;
const ensureAdminIsInitialized = () => {
  if (!is_admin_initialized) {
    initializeApp();
    is_admin_initialized = true;
  }
};

// Smarter cold boot functions
const function_name = process.env.FUNCTION_NAME || process.env.K_SERVICE;

if (!function_name || function_name === "invitations") {
  ensureAdminIsInitialized();
  const db = fs_extern();
  const notify = messaging();

  exports.invitations = fs_intern
    .document("friends/{userId}")
    .onUpdate((change, context) => {
      const previousList: string[] = change.before.get("friends");
      const newList: string[] = change.after.get("friends");
      const uid: string = context.params.userId;
      const fid: string | undefined = newList
        .filter((id: string) => !previousList.includes(id))
        .pop();

      return fid === undefined
        ? Promise.resolve().then(() =>
            logger.log("Ignored : Friend removed or no change")
          )
        : db
            .doc("friends/" + fid)
            .get()
            .then((friendsDoc) =>
              !friendsDoc.exists
                ? Promise.resolve().then(() =>
                    logger.error("Ignored : friends/" + fid + " doesn't exist")
                  )
                : friendsDoc.get("friends").includes(uid)
                ? Promise.resolve().then(() =>
                    logger.log(
                      "Ignored : " + uid + " already exist in friends/" + fid
                    )
                  )
                : db
                    .doc("invitations/" + fid)
                    .get()
                    .then((invitationsDoc) =>
                      !invitationsDoc.exists
                        ? Promise.resolve().then(() =>
                            logger.error(
                              "Ignored : invitations/" + fid + " doesn't exist"
                            )
                          )
                        : invitationsDoc.get("invitations").includes(uid)
                        ? Promise.resolve().then(() =>
                            logger.log(
                              "Ignored : " +
                                uid +
                                " already exist in invitations/" +
                                fid
                            )
                          )
                        : Promise.resolve().then(() =>
                            db
                              .doc("invitations/" + fid)
                              .update({
                                invitations: invitationsDoc
                                  .get("invitations")
                                  .concat(uid)
                              })
                              .then(async () => {
                                logger.log(
                                  "Friend added for " +
                                    uid +
                                    " - Invitation added for " +
                                    fid
                                );
                                const tokens: string[] = [];
                                const user = await db.doc("users/" + fid).get();
                                const mobileToken = user.get("mobile");
                                if (mobileToken !== undefined)
                                  tokens.push(mobileToken["token"]);
                                /* const webToken = user.get("web");
                                if (webToken !== undefined)
                                  tokens.push(webToken["token"]); */
                                return tokens.length < 1
                                  ? Promise.resolve().then(() =>
                                      logger.error(
                                        "Ignored : No fcmToken found on users/" +
                                          fid
                                      )
                                    )
                                  : notify
                                      .sendMulticast({
                                        tokens: tokens,
                                        notification: {
                                          title:
                                            "New invitation from " +
                                            (
                                              await db.doc("users/" + uid).get()
                                            ).get("nickname"),
                                          body: "Tap to open"
                                        },
                                        data: {
                                          screen: "/friends"
                                        },
                                        android: {
                                          collapseKey: "invitations",
                                          notification: {
                                            priority: "max",
                                            clickAction:
                                              "FLUTTER_NOTIFICATION_CLICK",
                                            channelId: "ZONE_ALERT",
                                            visibility: "public",
                                            sound: "default"
                                          }
                                        }
                                        /* webpush: { headers: { TTL: "600" } } */
                                      })
                                      .then(() =>
                                        logger.log(
                                          "Notification sent to " + fid
                                        )
                                      )
                                      .catch((err) =>
                                        logger.error(
                                          "Notification error on users/" +
                                            fid +
                                            ":",
                                          err
                                        )
                                      );
                              })
                              .catch((err) =>
                                logger.error(
                                  "Update error on invitations/" + fid + ":",
                                  err
                                )
                              )
                          )
                    )
                    .catch((err) =>
                      logger.error(
                        "Access error on invitations/" + fid + ":",
                        err
                      )
                    )
            )
            .catch((err) =>
              logger.error("Access error on friends/" + fid + ":", err)
            );
    });
}

if (!function_name || function_name === "cleanup") {
  ensureAdminIsInitialized();
  const db = fs_extern();
  const account = auth();

  exports.cleanup = https.onRequest(async (_req, resp) => {
    try {
      const invalidUids: string[] = (
        await db
          .collection("users")
          .where("fullName", "==", "Nuage Laboratoire")
          .get()
      ).docs.map((user) => user.id);

      invalidUids.forEach(async (uid) => {
        await db.doc("users/" + uid).delete();
        await db.doc("friends/" + uid).delete();
        await db.doc("invitations/" + uid).delete();
      });

      const validUids: string[] = (await db.collection("users").get()).docs.map(
        (user) => user.id
      );

      let pageToken: string | undefined;
      do {
        const listUsers: auth.ListUsersResult = await account.listUsers(
          1000,
          pageToken
        );
        invalidUids.push(
          ...listUsers.users
            .map((user) => user.uid)
            .filter((uid) => !validUids.includes(uid))
        );
        pageToken = listUsers.pageToken;
      } while (!!pageToken);

      await account.deleteUsers(invalidUids);

      resp.status(200).send({ "Deleted users": invalidUids });
      logger.log("Deleted users:", invalidUids);
    } catch (err) {
      resp.status(500).send("Cleaning error on users");
      logger.error("Cleaning error on users :", err);
    }
  });
}
