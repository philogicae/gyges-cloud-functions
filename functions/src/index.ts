// Firebase Admin SDK to access Cloud Firestore
import { firestore as fs_extern, initializeApp } from "firebase-admin";

// Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers
import { firestore as fs_intern, logger } from "firebase-functions";

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

  exports.invitations = fs_intern
    .document("friends/{userId}")
    .onUpdate((change, context) => {
      const previousList: String[] = change.before.get("friends");
      const newList: String[] = change.after.get("friends");
      const uid: String = context.params.userId;
      const fid: String | undefined = newList
        .filter((id: String) => !previousList.includes(id))
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
                              .then(() =>
                                logger.log(
                                  "Friend added for " +
                                    uid +
                                    " - Invitation added for " +
                                    fid
                                )
                              )
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
