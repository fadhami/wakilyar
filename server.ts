import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Endpoint 1: Generate Case Metadata, Roadmap, Simulator details and Deadlines
app.post("/api/generate", async (req, res) => {
  try {
    const { notes, category, customRules, title, thinkingMode, plaintiff, defendant, activityType } = req.body;

    if (!notes || typeof notes !== "string" || !notes.trim()) {
      res.status(400).json({ error: "یادداشت‌های پرونده الزامی است." });
      return;
    }

    const ai = getAiClient();
    const model = thinkingMode ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";

    const config: any = {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          caseNumber: { type: Type.STRING },
          declarationNumber: { type: Type.STRING },
          parties: {
            type: Type.OBJECT,
            properties: {
              plaintiff: { type: Type.STRING },
              defendant: { type: Type.STRING }
            },
            required: ["plaintiff", "defendant"]
          },
          extractedMetadata: {
            type: Type.OBJECT,
            properties: {
              caseNumber: { type: Type.STRING },
              declarationNumber: { type: Type.STRING },
              plaintiff: { type: Type.STRING },
              defendant: { type: Type.STRING },
              courtName: { type: Type.STRING },
              subject: { type: Type.STRING },
              activityType: { type: Type.STRING },
              keyDates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    date: { type: Type.STRING }
                  },
                  required: ["label", "date"]
                }
              }
            },
            required: ["caseNumber", "declarationNumber", "plaintiff", "defendant", "courtName", "subject", "activityType", "keyDates"]
          },
          roadmap: {
            type: Type.OBJECT,
            properties: {
              steps: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    status: { type: Type.STRING } // 'pending', 'completed', 'active'
                  },
                  required: ["id", "title", "description", "status"]
                }
              },
              missingDetails: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    question: { type: Type.STRING },
                    field: { type: Type.STRING }
                  },
                  required: ["id", "question", "field"]
                }
              }
            },
            required: ["steps", "missingDetails"]
          },
          courtSimulator: {
            type: Type.OBJECT,
            properties: {
              opposingArguments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    point: { type: Type.STRING },
                    counterStrategy: { type: Type.STRING }
                  },
                  required: ["point", "counterStrategy"]
                }
              },
              judgeExpectedQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    suggestedAnswer: { type: Type.STRING }
                  },
                  required: ["question", "suggestedAnswer"]
                }
              },
              scenarios: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    condition: { type: Type.STRING },
                    defenseStrategy: { type: Type.STRING }
                  },
                  required: ["condition", "defenseStrategy"]
                }
              }
            },
            required: ["opposingArguments", "judgeExpectedQuestions", "scenarios"]
          },
          deadlines: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                date: { type: Type.STRING }, // YYYY-MM-DD
                type: { type: Type.STRING }, // 'hearing', 'objection', 'submission'
                description: { type: Type.STRING }
              },
              required: ["id", "title", "date", "type", "description"]
            }
          },
          ganttPhases: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                startDate: { type: Type.STRING }, // YYYY-MM-DD
                endDate: { type: Type.STRING }, // YYYY-MM-DD
                progress: { type: Type.INTEGER },
                color: { type: Type.STRING }
              },
              required: ["id", "name", "startDate", "endDate", "progress", "color"]
            }
          }
        },
        required: [
          "title", "caseNumber", "declarationNumber", "parties", 
          "extractedMetadata", "roadmap", "courtSimulator", "deadlines", "ganttPhases"
        ]
      }
    };

    if (thinkingMode) {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.HIGH
      };
    }

    const currentYear = 2026;
    const currentMonth = "07";
    const currentDay = "19";

    const prompt = `
You are an advanced, expert Persian AI Legal Intelligence System specifically designed to assist defense attorneys and litigators in Iran.
Analyze the following raw legal notes, documents, voice summaries, and case parameters to construct a structured Legal Assistant Package.

Context Information:
- Current Date is July 19, 2026 (1405-04-28 in Solar Hijri). 
- All calculated dates MUST be relative to this date, formatted as "YYYY-MM-DD" Gregorian (e.g. between July 2026 and October 2026) representing upcoming milestones.
- Case Category: ${category || "civil"} (حقوقی یا کیفری)
- Optional Custom Rules / Lawyer Directives: "${customRules || "None"}"
- Suggested Case Name: "${title || "بررسی پرونده جدید"}"
${plaintiff ? `- Explicit Plaintiff/Shaki (خواهان/شاکی) Name: "${plaintiff}"` : ""}
${defendant ? `- Explicit Defendant/Motashaki (خوانده/متهم) Name: "${defendant}"` : ""}
${activityType ? `- Explicit Judicial Activity / Claim Type (نوع فعالیت/خواسته): "${activityType}"` : ""}

Raw Case Notes / Uploaded Document Text:
"${notes}"

CRITICAL INSTRUCTIONS:
1. All generated text inside the properties (titles, descriptions, questions, roadmaps, simulated judge queries, opposing arguments, counter strategies, defense strategies) MUST be strictly in Persian/Farsi (فارسی) with correct judicial vocabulary (e.g., using terms like "خواهان", "خوانده", "مشتکی‌عنه", "شاکی", "ماده قانونی", "رای وحدت رویه", "واخواهی", "تجدیدنظرخواهی").
2. EXTRACT METADATA: Perform OCR/information extraction on the raw notes.
   - If Explicit Plaintiff Name is provided ("${plaintiff || ""}"), you MUST use it exactly as plaintiff in "parties" and "extractedMetadata". Otherwise extract or synthesize.
   - If Explicit Defendant Name is provided ("${defendant || ""}"), you MUST use it exactly as defendant in "parties" and "extractedMetadata". Otherwise extract or synthesize.
   - In "extractedMetadata.activityType", output the provided Explicit Judicial Activity ("${activityType || ""}") or synthesize a fitting activity type (e.g. "تنظیم لایحه" or "رد اظهارنامه").
   - Identify or synthesize Court Name, Case Number, Declaration Number, Subject of Dispute, and key dates.
3. ADAPT TO ACTIVITY TYPE:
   - If an Explicit Judicial Activity is given (e.g., "${activityType || ""}"), tailor the 4 roadmap steps, 2 opposing arguments, 2 judge expected questions, and 3 deadlines specifically to address that activity! E.g. if the activity is "رد اظهارنامه" (Rejecting Demand Notice), frame the judge queries and opposing arguments around the validity of the demand notice and grounds to dismiss it.
4. STRUCTURE ROADMAP (تبیین مراحل و رفع ابهام):
   - Outline exactly 4 progressive steps for the lawyer. Set the first step to 'active' or 'completed' and others to 'pending'.
   - Formulate exactly 3 precise legal clarification questions (missingDetails) to ask the lawyer before drawing up the final pleading. These should be extremely analytical and professional (e.g., "آیا ابلاغیه واقعی بوده یا قانونی؟", "آیا سند رسمی مالکیت ضمیمه شده است؟").
5. COURT SIMULATOR (شبیه‌ساز دادگاه):
   - Opposing arguments: Provide 2 core points the opposite counsel will likely argue, along with a solid counter-strategy for each.
   - Judge Expected Questions: Provide 2 sharp questions the judge is likely to ask the defense attorney, and the best recommended answer for each based on Iranian civil/penal codes.
   - Scenarios: List 2 What-If scenarios (e.g., "اگر خواهان سند عادی ارائه دهد...", "اگر متهم منکر امضا شود...").
6. DEADLINES & GANTT PHASES:
   - Calculate at least 3 critical upcoming deadlines relative to the current date (2026-07-19). Examples: "مهلت ارسال لایحه دفاعیه" (within 5 days), "تاریخ جلسه اول دادرسی" (within 30 days), "مهلت اعتراض به قرار" (within 20 days). Assign types 'hearing', 'objection', or 'submission' respectively.
   - Generate at least 4 Gantt chart phases representing the case progression from today (2026-07-19) onwards (e.g., Phase 1: مطالعه پرونده و تبادل لوایح, Phase 2: جلسه دادرسی, Phase 3: صدور رای بدوی, Phase 4: واخواهی و تجدیدنظرخواهی). Assign realistic start/end dates in YYYY-MM-DD.

Ensure the returned JSON strictly adheres to the requested schema.
`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config,
    });

    const text = response.text;
    if (!text) {
      throw new Error("پاسخی از مدل دریافت نشد.");
    }

    const data = JSON.parse(text);
    res.json(data);
  } catch (error: any) {
    console.error("Generate Case error:", error);
    res.status(500).json({ error: error.message || "خطا در ارزیابی و استخراج اطلاعات پرونده." });
  }
});

// Endpoint 2: Draft Pleading (Step 3: تدوین نهایی لایحه)
app.post("/api/draft-pleading", async (req, res) => {
  try {
    const { rawNotes, category, customRules, extractedMetadata, userAnswers, thinkingMode } = req.body;

    const ai = getAiClient();
    const model = thinkingMode ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";

    const config: any = {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          introduction: { type: Type.STRING },
          legalArguments: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          },
          conclusion: { type: Type.STRING },
          fullTextMarkdown: { type: Type.STRING }
        },
        required: ["title", "introduction", "legalArguments", "conclusion", "fullTextMarkdown"]
      }
    };

    if (thinkingMode) {
      config.thinkingConfig = {
        thinkingLevel: ThinkingLevel.HIGH
      };
    }

    const prompt = `
You are an elite, senior Iranian defense lawyer with decades of experience drafting flawless pleadings (لایحه دفاعیه) for civil and criminal courts.
Your task is to write a highly persuasive, professionally structured legal pleading in Farsi/Persian (فارسی).

Case Parameters:
- Category: ${category || "civil"}
- Metadata: ${JSON.stringify(extractedMetadata || {})}
- Original Notes: "${rawNotes}"
- Custom Guidelines/Rules: "${customRules || "None"}"
- Answers to Clarification Questions: ${JSON.stringify(userAnswers || [])}

Instructions for Writing the Pleading:
1. Tone: Deeply respectful, highly formal, extremely analytical, utilizing traditional Islamic/Iranian judicial phrases (e.g. "ریاست محترم شعبه...", "با سلام و تقدیم احترام", "در مقام دفاع به استحضار می‌رساند...").
2. Title: A formal header for the pleading (e.g., "لایحه دفاعیه در خصوص پرونده کلاسه...").
3. Introduction: Summarize the dispute clearly, introducing your client's standing and indicating the purpose of the pleading.
4. Legal Arguments: Cite specific articles of Iranian law (e.g. Civil Code - قانون مدنی, Penal Code - قانون مجازات اسلامی, Civil Procedure Code - قانون آیین دادرسی مدنی) and Supreme Court Precedents (آرای وحدت رویه دیوان عالی کشور) that directly exonerate or support your client's position. Build extremely tight, bulleted legal rationales.
5. Conclusion: Conclude with a specific, humble demand to the honorable Judge (مثلاً: "صدور حکم برائت", "رد دعوای خواهان", "کاهش مجازات").
6. FullTextMarkdown: Merge all components into a beautiful, ready-to-copy, print-ready Persian Markdown document. Include appropriate formatting like headers, bold text, and signature blocks.

Always return the response in strict JSON according to the schema.
`;

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config,
    });

    const text = response.text;
    if (!text) {
      throw new Error("لایحه تولید نشد.");
    }

    const data = JSON.parse(text);
    res.json(data);
  } catch (error: any) {
    console.error("Draft pleading error:", error);
    res.status(500).json({ error: error.message || "خطا در تنظیم و تدوین نهایی لایحه." });
  }
});

// Endpoint 3: Interactive Legal Copilot
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, caseData, persona, thinkingMode } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "لیست پیام‌ها خالی است." });
      return;
    }

    const ai = getAiClient();
    const model = thinkingMode ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";

    let systemInstruction = "";
    if (persona === "refiner") {
      systemInstruction = `You are a Senior Iranian Judicial Expert and Pleading Architect. Your purpose is to help the defense lawyer refine and polish the drafted pleading (لایحه).
All responses MUST be strictly in Persian/Farsi (فارسی).
Current Case Context:
- Case Number: ${caseData?.caseNumber || "N/A"}
- Parties: ${caseData?.parties?.plaintiff || "شاکی"} vs ${caseData?.parties?.defendant || "متهم"}
- Current Pleading Title: ${caseData?.pleading?.title || "ثبت نشده"}

Guide the user on:
- Adding specific articles of Iranian law (e.g., Civil Code, Penal Code).
- Rephrasing sentences to sound more professional and persuasive to the judge.
- Drafting custom alternative paragraphs for the pleading.
Keep responses extremely authoritative, legally sound, and structured.`;
    } else if (persona === "simulator") {
      systemInstruction = `You are the opposing litigant's attorney (وکیل طرف مقابل) in a simulated courtroom hearing in Iran.
Your purpose is to test the user's defense strategy by arguing the opposing side's case aggressively but professionally.
All responses MUST be strictly in Persian/Farsi (فارسی).
Current Case Context:
- Plaintiff (Client of opposing counsel): ${caseData?.parties?.plaintiff || "شاکی/خواهان"}
- Defendant (User's Client): ${caseData?.parties?.defendant || "خوانده/متهم"}
- Subject: ${caseData?.extractedMetadata?.subject || "دعوا"}

When the user states their argument or defense, challenge them using realistic court-arguments based on Iranian law. Cite potential vulnerabilities in their defense. Keep responses sharp, realistic, and formatted in character as a competing lawyer.`;
    } else {
      // coach / judge simulator
      systemInstruction = `You are the Presiding Judge (ریاست محترم دادگاه) overseeing this case.
Your purpose is to interrogate the defense attorney, raise legal obstacles, and ask the tough judicial questions they will face during the actual hearing.
All responses MUST be strictly in Persian/Farsi (فارسی).
Current Case Context:
- Case Number: ${caseData?.caseNumber || "N/A"}
- Category: ${caseData?.category || "Civil"}

Ask the lawyer to defend specific points, explain discrepancies, or provide immediate proof for claims. Keep your tone highly dignified, authoritative, neutral, and precise, mirroring a experienced Iranian judge.`;
    }

    const chatConfig: any = {
      systemInstruction,
    };

    if (thinkingMode) {
      chatConfig.thinkingConfig = {
        thinkingLevel: ThinkingLevel.HIGH
      };
    }

    const contents = messages.map((m: any) => ({
      role: m.sender === "user" ? "user" : "model",
      parts: [{ text: m.text }]
    }));

    const response = await ai.models.generateContent({
      model,
      contents,
      config: chatConfig,
    });

    const botText = response.text;
    res.json({ text: botText });
  } catch (error: any) {
    console.error("Legal Copilot chat error:", error);
    res.status(500).json({ error: error.message || "خطا در ارتباط با هوش مصنوعی." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite dev middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Setting up static production asset routing...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Smart Legal Assistant Express Server running on port ${PORT}`);
  });
}

startServer();
