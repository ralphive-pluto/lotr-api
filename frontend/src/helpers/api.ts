import { UserInfo } from "../pages/Account";

let host: string;
if (process.env.NODE_ENV === "development") {
  // Override via REACT_APP_API_URL so parallel dev stacks can target a
  // non-default backend port. Falls back to the canonical :3001 dev port.
  host = process.env.REACT_APP_API_URL || "http://localhost:3001";
} else {
  host = `${window.location.protocol}//${window.location.hostname}${
    window.location.port ? ":" + window.location.port : ""
  }`;
}
interface RequestOptions {
  method: string;
  headers: {
    Accept: string;
    "Content-Type": string;
  };
  body?: string;
}

export async function login(
  values: Record<string, string>,
): Promise<Record<string, string | boolean>> {
  const requestOptions: RequestOptions = {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (values) {
    requestOptions.body = JSON.stringify(values);
  }
  try {
    const response = await fetch(`${host}/auth/login`, requestOptions);
    if (response.status > 399) {
      const body = await response.json();
      return {
        success: false,
        message: body.message,
      };
    } else {
      const json = await response.json();
      return json;
    }
  } catch (e) {
    return {
      success: false,
      message: "Something went wrong.",
    };
  }
}

export async function register(
  values: Record<string, string>,
): Promise<Record<string, string | boolean>> {
  const requestOptions: RequestOptions = {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (values) {
    requestOptions.body = JSON.stringify(values);
  }
  try {
    const response = await fetch(`${host}/auth/register`, requestOptions);
    if (response.status > 399) {
      const body = await response.json();
      return {
        success: false,
        message: body.message,
      };
    } else {
      const json = await response.json();
      return json;
    }
  } catch (e) {
    return {
      success: false,
      message: "Something went wrong.",
    };
  }
}

export async function logout(): Promise<
  | Record<string, string | boolean>
  | {
      token: string;
    }
> {
  const requestOptions: RequestOptions = {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  try {
    const response = await fetch(`${host}/auth/logout`, requestOptions);
    if (response.status > 399) {
      const body = await response.json();
      return {
        success: false,
        message: body.message,
      };
    } else {
      const json = await response.json();
      return json;
    }
  } catch (e) {
    return {
      success: false,
      message: "Something went wrong.",
    };
  }
}

export interface QuizQuestion {
  id: string;
  category: "who-said-it" | "quote-movie" | "character-trait";
  prompt: string;
  options: string[];
  answerIndex: number;
  source: { label: string; wikiUrl?: string };
}

export async function getQuizRound(): Promise<QuizQuestion[]> {
  const requestOptions: RequestOptions = {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  const response = await fetch(`${host}/v2/quiz/round`, requestOptions);
  if (response.status > 399) {
    throw new Error(`Quiz endpoint returned ${response.status}`);
  }
  const json = await response.json();
  if (!Array.isArray(json)) {
    throw new Error("Quiz endpoint returned unexpected payload");
  }
  return json as QuizQuestion[];
}

export async function getUserInfo(): Promise<UserInfo | null> {
  var match = document.cookie.match(new RegExp("(^| )lotr-api=([^;]+)"));
  if (match) {
    const jwt = match[2];
    const parsedJwt = JSON.parse(atob(jwt.split(".")[1]));
    const { user } = parsedJwt;
    return user;
  } else {
    return null;
  }
}
