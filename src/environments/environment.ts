/**
 * Runtime configuration. Fill in the OAuth client ids to enable the cloud providers;
 * see README.md ("Configurar Google Drive / OneDrive") for how to create them.
 * Leaving an id empty simply hides that provider behind an "unavailable" notice.
 */
export const environment = {
  production: false,
  googleDrive: {
    clientId: '511892151745-vr4vpjhnvi7g4ec30cocvg7svo6rhlfp.apps.googleusercontent.com',
    /** Optional: only needed if you later switch to the Google Picker UI. */
    apiKey: '',
  },
  oneDrive: {
    clientId: '',
    /** 'common' accepts both personal Microsoft accounts and work/school accounts. */
    authority: 'https://login.microsoftonline.com/common',
  },
  /**
   * URL of the 'notify' Cloud Function (functions/). Empty: no push notifications; devices see
   * new backups when they open the app or press Sincronizar.
   */
  notifyUrl: 'https://notify-untngiirca-rj.a.run.app',
};
