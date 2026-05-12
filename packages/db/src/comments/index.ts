// Track 5 #14 (Section C) — PIREP Discussion Comments.
//
// Free-form comments unter PIREPs. Helpers für list/create/update/delete,
// plus error-classes und body-constants. Konsumiert von der PIREP-detail-
// page comments-section.
export {
  listCommentsForPirep,
  getCommentCount,
  createComment,
  updateComment,
  deleteComment,
  CommentNotFoundError,
  CommentForbiddenError,
  CommentEditWindowClosedError,
  CommentBodyError,
  COMMENT_MAX_BODY_CHARS,
  COMMENT_EDIT_WINDOW_MS,
  type CommentEntry,
} from "./comment.js";
