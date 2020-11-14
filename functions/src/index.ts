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

if (!function_name || function_name === "cleanup") {
  ensureAdminIsInitialized();
  const db = fs_extern();
  const accounts = auth();

  exports.cleanup = https.onRequest((_req, resp) => {
    return Promise.resolve()
      .then(async () => {
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
          await db.doc("managers/" + uid).delete();
        });

        const validUids: string[] = (
          await db.collection("users").get()
        ).docs.map((user) => user.id);

        let pageToken: string | undefined;
        do {
          const listUsers: auth.ListUsersResult = await accounts.listUsers(
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

        await accounts.deleteUsers(invalidUids);

        resp.status(200).send({ "Deleted users": invalidUids });
        logger.log("Deleted users:", invalidUids);
      })
      .catch((err) => {
        resp.status(500).send("Cleaning error on users");
        logger.error("Cleaning error on users :", err);
      });
  });
}

if (!function_name || function_name === "invitations") {
  ensureAdminIsInitialized();
  const db = fs_extern();
  const notify = messaging();

  exports.invitations = fs_intern
    .document("friends/{userId}")
    .onUpdate((change, context) => {
      const previousList: string[] = change.before.get("users");
      const newList: string[] = change.after.get("users");
      const uid: string = context.params.userId;
      const fid: string | undefined = newList
        .filter((id: string) => !previousList.includes(id))
        .pop();

      return Promise.resolve().then(() =>
        fid === undefined
          ? logger.log("Ignored : Friend removed or no change")
          : db
              .doc("friends/" + fid)
              .get()
              .then((friendsDoc) =>
                !friendsDoc.exists
                  ? logger.error("Ignored : friends/" + fid + " doesn't exist")
                  : friendsDoc.get("users").includes(uid)
                  ? logger.log(
                      "Ignored : " + uid + " already exist in friends/" + fid
                    )
                  : db
                      .doc("invitations/" + fid)
                      .get()
                      .then((invitationsDoc) =>
                        !invitationsDoc.exists
                          ? logger.error(
                              "Ignored : invitations/" + fid + " doesn't exist"
                            )
                          : invitationsDoc.get("users").includes(uid)
                          ? logger.log(
                              "Ignored : " +
                                uid +
                                " already exist in invitations/" +
                                fid
                            )
                          : db
                              .doc("invitations/" + fid)
                              .update({
                                users: invitationsDoc.get("users").concat(uid)
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
                                  ? logger.error(
                                      "Ignored : No fcmToken found on users/" +
                                        fid
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
                      .catch((err) =>
                        logger.error(
                          "Access error on invitations/" + fid + ":",
                          err
                        )
                      )
              )
              .catch((err) =>
                logger.error("Access error on friends/" + fid + ":", err)
              )
      );
    });
}

if (!function_name || function_name === "managers") {
  ensureAdminIsInitialized();
  const db = fs_extern();
  const notify = messaging();

  exports.managers = fs_intern
    .document("games/{gameId}")
    .onCreate((snapshot, context) => {
      const uid: string = context.params.gameId;
      const player1: string = snapshot.get("player1");
      const player2: string = snapshot.get("player2");

      return db
        .doc("managers/" + player2)
        .get()
        .then((managersDoc) =>
          !managersDoc.exists
            ? logger.error("Ignored : managers/" + player2 + " doesn't exist")
            : managersDoc.get("games").includes(uid)
            ? logger.log(
                "Ignored : " + uid + " already exist in managers/" + player2
              )
            : db
                .doc("managers/" + player2)
                .update({
                  games: managersDoc.get("games").concat(uid)
                })
                .then(async () => {
                  logger.log(
                    "Game " +
                      uid +
                      " created by " +
                      player1 +
                      " and added for " +
                      player2
                  );
                  const tokens: string[] = [];
                  const user = await db.doc("users/" + player2).get();
                  const mobileToken = user.get("mobile");
                  if (mobileToken !== undefined)
                    tokens.push(mobileToken["token"]);
                  /* const webToken = user.get("web");
                      if (webToken !== undefined)
                        tokens.push(webToken["token"]); */
                  return tokens.length < 1
                    ? logger.error(
                        "Ignored : No fcmToken found on users/" + player2
                      )
                    : notify
                        .sendMulticast({
                          tokens: tokens,
                          notification: {
                            title:
                              "Invitation to play with " +
                              (await db.doc("users/" + player1).get()).get(
                                "nickname"
                              ),
                            body: "Tap to open"
                          },
                          data: {
                            screen: "/start"
                          },
                          android: {
                            collapseKey: "games",
                            notification: {
                              priority: "max",
                              clickAction: "FLUTTER_NOTIFICATION_CLICK",
                              channelId: "ZONE_ALERT",
                              visibility: "public",
                              sound: "default"
                            }
                          }
                          /* webpush: { headers: { TTL: "600" } } */
                        })
                        .then(() =>
                          logger.log("Notification sent to " + player2)
                        )
                        .catch((err) =>
                          logger.error(
                            "Notification error on users/" + player2 + ":",
                            err
                          )
                        );
                })
                .catch((err) =>
                  logger.error("Update error on managers/" + player2 + ":", err)
                )
        )
        .catch((err) =>
          logger.error("Access error on managers/" + player2 + ":", err)
        );
    });
}

if (!function_name || function_name === "games") {
  ensureAdminIsInitialized();
  const db = fs_extern();
  const notify = messaging();

  exports.games = fs_intern
    .document("games/{gameId}")
    .onUpdate((change, context) => {
      const uid: string = context.params.gameId;
      const data = change.after;
      const name: string = data.get("name");
      const player1: string = data.get("player1");
      const player2: string = data.get("player2");
      const state: string = data.get("state");
      const lastPlayer: string = state[0] == "1" ? player1 : player2;
      const targetPlayer: string = state[0] == "1" ? player2 : player1;
      let action: String;
      switch (state[1]) {
        case "D":
          action = "declined...";
          break;
        case "P":
          action = "played. It's your turn !";
          break;
        case "W":
          action = "won !";
          break;
        case "L":
          action = "lost !";
          break;
        default:
          return Promise.resolve().then(() =>
            logger.error("Bad state on games/" + uid)
          );
      }

      return Promise.resolve().then(async () => {
        const tokens: string[] = [];
        const user = await db.doc("users/" + targetPlayer).get();
        const mobileToken = user.get("mobile");
        if (mobileToken !== undefined) tokens.push(mobileToken["token"]);
        /* const webToken = user.get("web");
            if (webToken !== undefined)
              tokens.push(webToken["token"]); */
        return tokens.length < 1
          ? logger.error("Ignored : No fcmToken found on users/" + targetPlayer)
          : notify
              .sendMulticast({
                tokens: tokens,
                notification: {
                  title:
                    name +
                    " : " +
                    (await db.doc("users/" + lastPlayer).get()).get(
                      "nickname"
                    ) +
                    " " +
                    action,
                  body: "Tap to open"
                },
                data: {
                  screen: "/start"
                },
                android: {
                  collapseKey: "games",
                  notification: {
                    priority: "max",
                    clickAction: "FLUTTER_NOTIFICATION_CLICK",
                    channelId: "ZONE_ALERT",
                    visibility: "public",
                    sound: "default"
                  }
                }
                /* webpush: { headers: { TTL: "600" } } */
              })
              .then(() => logger.log("Notification sent to " + targetPlayer))
              .catch((err) =>
                logger.error(
                  "Notification error on users/" + targetPlayer + ":",
                  err
                )
              );
      });
    });
}
