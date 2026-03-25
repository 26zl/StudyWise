import type { PartialMessages } from "../types";

export const enMessages = {
  common: {
    actions: {
      askAi: "Ask AI",
      backToSignIn: "Back to sign in",
      cancel: "Cancel",
      change: "Change",
      clearAll: "Clear all",
      delete: "Delete",
      editProfileSecurity: "Edit profile and security",
      goToDashboard: "Go to dashboard",
      goToSettings: "Go to settings",
      hide: "Hide",
      markAllAsRead: "Mark all as read",
      newConversation: "New conversation",
      reload: "Reload",
      retry: "Try again",
      restoreConnection: "Restore connection",
      save: "Save",
      sendCode: "Send code",
      completeReset: "Set new password",
      show: "Show",
      signOut: "Sign out",
      start: "Start",
      verifyCode: "Verify code",
    },
    labels: {
      canvasUser: "Canvas user",
      notSignedIn: "Not signed in",
    },
    loading: {
      aiChat: "Loading AI chat...",
      assignments: "Loading assignments...",
      calendar: "Loading calendar...",
      canvas: "Loading Canvas...",
      chatHistory: "Loading conversation history...",
      dashboard: "Loading dashboard...",
      generic: "Loading...",
      notifications: "Loading notifications...",
      overview: "Loading overview...",
      profile: "Loading profile...",
      quiz: "Loading quiz...",
      redirectingToSignIn: "Redirecting to sign in...",
      settings: "Loading settings...",
      userData: "Loading user data...",
    },
  },
  dashboard: {
    sections: {
      admin: "administration",
      aiChat: "AI chat",
      calendar: "calendar",
      canvas: "Canvas",
      notifications: "notifications",
      quiz: "quiz",
      settings: "settings",
    },
    sidebar: {
      admin: "Administration",
      aiAssistant: "AI Assistant",
      announcements: "Announcements",
      assignments: "Assignments",
      calendar: "Calendar",
      canvas: "Canvas",
      chatHistory: "Conversation history",
      courses: "Courses",
      noChatsYet: "No conversations yet",
      notifications: "Notifications",
      overview: "Overview",
      quiz: "Quiz / Flashcards",
      settings: "Settings",
      taskBreakdown: "AI Task Breakdown",
    },
  },
  chatHistory: {
    clearConfirmDescription: "All saved conversations will be removed. This cannot be undone.",
    clearConfirmTitle: "Delete the entire conversation history?",
    clearError: "Could not delete the history",
    clearSuccess: "Conversation history deleted",
    deleteError: "Could not delete the conversation",
    deleteSuccess: "Conversation deleted",
    saveError: "Could not save the conversation",
  },
  auth: {
    forgotPassword: {
      complete: {
        description: "Your password has been updated, and you are being redirected to the dashboard.",
        title: "Password updated",
      },
      code: {
        descriptionEmail:
          "Enter the code we sent to the email address connected to your account.",
        label: "Verification code",
        placeholder: "123456",
      },
      description:
        "Forgot your password? Enter your email address, verify the code we send, and choose a new password.",
      emailOnly: "Email only",
      eyebrow: "Account recovery",
      identifier: {
        description:
          "Use the email address that is connected to your StudyWise account.",
        emailLabel: "Email address",
        emailPlaceholder: "name@example.com",
      },
      mfa: {
        description:
          "Your password is updated, but this account requires two-factor authentication before sign-in can finish. Go back to sign in to continue.",
        title: "Two-factor authentication required",
      },
      setCredential: {
        description: "Choose a new password for your email sign-in.",
        label: "New password",
        placeholder: "Enter new password",
      },
      sent: {
        emailDescription: "We have sent a recovery code to your email.",
        emailTitle: "Code sent by email",
      },
      steps: {
        identify: "Find your account",
        setCredential: "Choose a new password",
        verify: "Verify code",
      },
      thirdParty: {
        description:
          "If you usually sign in with Microsoft, Google, or Apple, you normally do not need to reset a password here. Go back to sign in and choose the same method you used before.",
        title: "Do you use Microsoft, Google, or Apple?",
      },
      support:
        "If you do not receive the code, check your spam folder. If you usually use Microsoft, Google, or Apple, go back and sign in with the same method.",
      title: "Forgot password?",
    },
    signIn: {
      forgotPasswordAction: "Recover access",
      forgotPasswordDescription:
        "For email sign-in. If you use Microsoft, Google, or Apple, continue with the same provider instead.",
      forgotPasswordTitle: "Forgot password?",
    },
  },
  errors: {
    boundary: {
      description:
        "Something went wrong in this part of the page. Try reloading it, or go back to the dashboard.",
      title: "Something went wrong",
    },
    canvas: {
      network: "Could not connect to Canvas. Check your internet connection.",
      notFound: "The resource was not found in Canvas.",
      permissionDenied: "You do not have access to this resource in Canvas.",
      rateLimit: "Too many requests to Canvas. Wait a few seconds and try again.",
      tokenInvalid:
        "Your Canvas API token is invalid, expired, or deleted in Canvas. Go to Settings to add a new token.",
      tokenMissing:
        "You must connect a Canvas API token to use this feature. Go to Settings to add a token.",
      timeout: "Fetching Canvas data took too long. Try again.",
      validation: "Check that your Canvas institution and URL are correct, then try again.",
    },
    generic: {
      auth: "You need to sign in again.",
      conflict: "The resource already exists.",
      default: "Something went wrong. Try again.",
      forbidden: "You do not have access to this resource.",
      network: "Network error. Check your internet connection.",
      notFound: "The resource was not found.",
      rateLimit: "Too many requests. Wait a bit and try again.",
      retry: "Try again.",
      server: "Server error. Try again shortly.",
      timeout: "The request took too long. Try again.",
      validation: "Invalid data. Check that all fields are filled out correctly.",
    },
    section: {
      load: "Could not load {section}. Try reloading the page.",
    },
    userData: {
      generic:
        "Could not load user data. Check your internet connection and try again.",
      sessionExpired: "Your session has expired. Sign in again.",
    },
  },
  notifications: {
    allMarkedAsRead: "All notifications marked as read",
    deadlineAt: "Deadline: {date}",
    empty: {
      all: "No notifications right now.",
      announcements: "No announcements right now.",
      deadlines: "No deadlines right now.",
      events: "No events right now.",
    },
    markAllAsRead: "Mark all as read",
    missingCanvasToken:
      "You must save a Canvas API token to fetch notifications.",
    partialLoadFallback:
      "Some notifications could not be loaded. The rest are shown below.",
    remaining: "{time} left",
    submitted: "Submitted",
    tabs: {
      all: "All",
      announcements: "Announcements",
      deadlines: "Deadlines",
      events: "Events",
    },
    title: "Notifications",
  },
  landing: {
    actions: {
      continueToDashboard: "Continue to Dashboard",
      signInOrRegister: "Sign in / Register",
    },
    features: {
      aiPartner: {
        description:
          "Stuck on something? Get instant help, explanations, and study tips from your personal AI assistant.",
        title: "AI Study Partner",
      },
      canvasIntegration: {
        description:
          "Connect Canvas once and get access to all your courses, modules, files, and announcements directly in the dashboard.",
        title: "Seamless Canvas Integration",
      },
      heading: "Features",
      overview: {
        description:
          "See everything happening today and in the coming days. Your personal tasks and school deadlines are gathered in one place.",
        title: "Complete Overview",
      },
    },
    hero: {
      description:
        "StudyWise gathers everything you need in one place. Get a full overview of Canvas, your upcoming assignments, and AI help to study smarter, not harder.",
      title: "Your Intelligent Study Assistant",
    },
  },
  overview: {
    missingCanvasPlanner:
      "You must connect a Canvas API token to fetch assignments and generate an AI study plan. Go to Settings to add a token.",
    noAssignments: {
      description:
        "Connect Canvas to see your assignments and get AI study plan suggestions",
      title: "No assignments found",
    },
    openChat: "AI Chat",
    quickAccess: {
      title: "Quick access",
    },
    quickActions: {
      aiAssistant: {
        description: "Get help with studies and assignments",
        title: "AI Assistant",
      },
      courses: {
        description: "See all your Canvas courses",
        title: "Courses",
      },
      taskBreakdown: {
        description: "Break assignments into smaller steps",
        title: "AI Task Breakdown",
      },
    },
    stats: {
      activeCourses: "Active courses",
      totalAssignments: "Total assignments",
      totalCourses: "Total courses",
      upcomingAssignments: "Upcoming assignments",
    },
    tabs: {
      ariaLabel: "Overview: My study plan or AI study planner",
      aiWeekPlan: "AI Study Planner",
      myWorkPlan: "My study plan",
    },
    title: "Overview",
    upcomingDeadlines: "Upcoming deadlines (next {days} days)",
  },
  settings: {
    accountSecurity: {
      action: "Edit profile and security",
      description:
        "Change email, password, enable two-factor authentication (2FA), and manage connected sign-in methods (Google, Microsoft, Apple). This is handled by our identity provider (Clerk).",
      title: "Account and security",
    },
    appearance: {
      darkMode: {
        description: "Switch between light and dark theme",
        disable: "Disable dark mode",
        enable: "Enable dark mode",
        label: "Dark mode",
      },
      title: "Appearance",
    },
    canvasContext: {
      description:
        "Choose which Canvas data the AI should have access to while you chat.",
      title: "AI Canvas context",
    },
    canvasToken: {
      alreadyConnectedDescription:
        "If this is your account, you can restore the connection here.",
      alreadyConnectedTitle: "This Canvas account is already connected",
      chooseInstitutionDescription:
        "Choose a Canvas institution before saving the token.",
      chooseInstitutionTitle: "Choose institution",
      connected: "The Canvas token is connected to your account.",
      currentInstitution: "Your institution: {institution}",
      customUrlPlaceholder: "https://your-school.instructure.com",
      deleteConfirm: "Are you sure?",
      deleteConnection: "Delete connection",
      deleteErrorTitle: "Could not delete token",
      deleteSuccessDescription: "The Canvas connection has been removed.",
      deleteSuccessTitle: "Canvas token deleted",
      deleting: "Deleting...",
      deletingButton: "Yes, delete Canvas API token",
      description:
        "Connect your Canvas account to fetch courses, announcements, deadlines, and lectures. Choose your institution below before saving the token. The list covers known Norwegian Canvas instances, and you can enter another Instructure URL if needed.",
      hide: "Hide",
      howTo: {
        step1: "Sign in to Canvas",
        step2: "Go to Settings → Approved integrations",
        step3: 'Click "New access token"',
        step4: "Copy the token and paste it here",
        title: "How to get an API token:",
      },
      institutionLabel: "Institution (Canvas)",
      institutionOther: "Other Instructure instance",
      institutionPlaceholder: "Choose institution",
      institutionRequired:
        "Choose an institution (or enter a URL) before saving the token.",
      invalidUrlDescription: "Enter a valid Canvas instance.",
      invalidUrlTitle: "Invalid Canvas URL",
      placeholder: "Paste your Canvas API token",
      restoreConnection: "Restore connection",
      restoring: "Restoring...",
      save: "Save token",
      saveErrorTitle: "Could not save token",
      saveSuccessDescription: "Canvas data will be available shortly.",
      saveSuccessTitle: "Canvas token saved",
      saving: "Saving...",
      show: "Show",
      title: "Canvas API Token",
    },
    chatHistory: {
      clearAll: "Delete all conversations",
      countOne: "{count} conversation",
      countOther: "{count} conversations",
      description: "Conversations are stored encrypted. You can delete all of them here.",
      loading: "Loading...",
      savedChats: "Saved conversations",
      title: "Conversation history",
    },
    deleteAccount: {
      cancel: "Cancel",
      confirmInstruction: "Type {keyword} to confirm.",
      confirmKeyword: "DELETE",
      confirmPlaceholder: "DELETE",
      deleteErrorTitle: "Could not delete account",
      deletePartialDescription:
        "Your data has been deleted, but the sign-in account could not be removed automatically. We will sign you out now.",
      deletePartialTitle: "StudyWise account deleted",
      deletePermanent: "Delete account permanently",
      deleteSuccessDescription:
        "Your StudyWise account and connected data have been deleted.",
      deleteSuccessTitle: "Account deleted",
      deleting: "Deleting account...",
      description:
        "This deletes your StudyWise account, Canvas connections, preferences, study plans, and conversation history. This action cannot be undone.",
      manualSignOutDescription:
        "Your StudyWise data has been deleted, but we could not end the sign-in session automatically.",
      manualSignOutTitle: "Manual sign-out required",
      start: "Start account deletion",
      title: "Delete account",
    },
    language: {
      help: "Choose the language for static interface text.",
      label: "Language",
      options: {
        en: "English",
        nb: "Norwegian",
      },
      title: "Language",
    },
    profile: {
      avatarAltCanvas: "Profile image for Canvas account",
      avatarAltStudyWise: "Profile image for StudyWise account",
      canvasConnection: "Canvas connection",
      connectedSince: "Connected since {date}",
      notConnected: "Not connected. Add a Canvas API token below.",
      studywiseAccount: "StudyWise account",
      title: "Profile",
    },
    title: "Settings",
  },
  admin: {
    title: "Administration",
    tabs: {
      stats: "Statistics",
      users: "Users",
      audit: "Audit log",
    },
    stats: {
      totalUsers: "Total users",
      adminUsers: "Administrators",
      regularUsers: "Regular users",
      canvasUsers: "With Canvas connection",
      totalChats: "Conversations",
      totalTasks: "Task breakdowns",
      totalEmbeddings: "Document chunks",
    },
    users: {
      email: "Email",
      role: "Role",
      name: "Name",
      created: "Created",
      canvas: "Canvas",
      provider: "Sign-in",
      actions: "Actions",
      searchPlaceholder: "Search by email...",
      noUsers: "No users found.",
      changeRole: "Change role",
      deleteUser: "Delete user",
      deleteConfirm: "Are you sure you want to delete this user? All data will be permanently removed.",
      roleChanged: "Role changed",
      userDeleted: "User deleted",
      cannotChangeSelf: "You cannot change your own role",
      cannotDeleteSelf: "You cannot delete your own account from here",
      you: "(you)",
    },
    audit: {
      action: "Action",
      category: "Category",
      outcome: "Outcome",
      actor: "Actor",
      time: "Time",
      noEntries: "No audit log entries.",
    },
    loading: "Loading administration...",
  },
} as const satisfies PartialMessages;
