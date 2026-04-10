
export const ROUTE_AUTH_REGISTER = '/auth/register'
export const ROUTE_AUTH_LOGIN = '/auth/login'
export const ROUTE_AUTH_VERIFY_EMAIL = '/auth/verify-email'
export const ROUTE_AUTH_GOOGLE_AUTH = '/auth/google-auth'
export const ROUTE_AUTH_REFRESH_TOKEN = '/auth/refresh-token'
export const ROUTE_AUTH_SEND_OTP = '/auth/send-otp'
export const ROUTE_AUTH_VERIFY_OTP = '/auth/verify-otp'
export const ROUTE_RESET_PASSWORD = '/auth/reset-password'
export const ROUTE_ME = '/me'
export const ROUTE_COMPLETE_PROFILE = '/auth/complete-profile'
export const ROUTE_DASHBOARD_STATS = '/dashboard-stats'

//survey
export const ROUTE_CREATE_SURVEY = '/create-survey'
export const ROUTE_CREATE_DRAFT_SURVEY = '/create-draft-survey'
export const ROUTE_UPDATE_DRAFT_SURVEY = '/update-draft-survey/:id'
export const ROUTE_PUBLISH_DRAFT_SURVEY = '/publish-draft-survey/:id'
export const ROUTE_GET_SURVEYS_BY_PROJECT_ID = '/get-surveys-by-project/:id'
export const ROUTE_GET_USER_SURVEY_ID = '/get-user-survey/:id'

//project
export const ROUTE_CREATE_PROJECT = '/create-project'
export const ROUTE_LIST_USER_PROJECTS = '/list-user-projects'
export const ROUTE_GET_PROJECT_ID= '/get-project/:id'
export const ROUTE_RENAME_PROJECT_ID = '/rename-project/:id'
export const ROUTE_PIN_PROJECT_ID = '/pin-project/:id'
export const ROUTE_DELETE_PROJECT_ID = '/delete-project/:id'


//seed
export const ROUTE_SEED_ALL = '/seed-all'