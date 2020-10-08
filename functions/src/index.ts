// Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
import functions = require("firebase-functions");

// Firebase Admin SDK to access Cloud Firestore.
import admin = require("firebase-admin");
admin.initializeApp();

// Cloud Firestore object
const db = admin.firestore();

exports.invitations = functions.firestore
  .document("friends/{userId}")
  .onUpdate((change, context) => {
    const uid: String = context.params.userId;
    const previousList: String[] = change.before.get("friends");
    const newList: String[] = change.after.get("friends");

    newList
      .filter((fid: String) => !previousList.includes(fid))
      .forEach((fid) => {
        db.doc("friends/" + fid)
          .get()
          .then((friendsDoc) => {
            if (friendsDoc.exists) {
              const friends: String[] = friendsDoc.get("friends");
              if (!friends.includes(uid)) {
                const invitationsList = db.doc("invitations/" + fid);
                invitationsList
                  .get()
                  .then((invitationsDoc) => {
                    if (invitationsDoc.exists) {
                      const invitations: String[] = invitationsDoc.get(
                        "invitations"
                      );
                      if (!invitations.includes(uid)) {
                        invitations.push(uid);
                        invitationsList
                          .update({ invitations: invitations })
                          .then(() =>
                            functions.logger.log(
                              "Friend added for ${uid} - Invitation added for ${fid}"
                            )
                          )
                          .catch(() =>
                            functions.logger.error(
                              "Update error with invitations/${fid}"
                            )
                          );
                      }
                    }
                  })
                  .catch(() =>
                    functions.logger.error(
                      "Access error with invitations/${fid}"
                    )
                  );
              }
            }
          })
          .catch(() =>
            functions.logger.error("Access error with friends/${fid}")
          );
      });
    return Promise.resolve();
  });
