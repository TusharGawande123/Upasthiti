"""The words on the gate poster in English, Marathi and Hindi (M6 F-99, decision 0038).

The poster layout (poster_pdf.py) holds no words: it takes one `PosterTexts`. The gate screen itself
stays English, so the names of what the worker sees there are printed as on the screen in every
language: the blue button "Punch with face", the words IN, OUT and NOT ACCEPTED. Texts with a number
or a date have a {placeholder} that the layout fills in. A text that has a legal meaning (the
privacy box) says the same in all three languages. Native readers review the Marathi and Hindi.
"""

from dataclasses import dataclass

DEFAULT_POSTER_LANGUAGE = "en"
POSTER_LANGUAGES = ("en", "mr", "hi")


@dataclass(frozen=True)
class PosterTexts:
    title: str
    ways_heading: str
    card_title: str
    card_hold: str
    card_photo: str
    face_title: str
    face_button: str  # as written on the gate screen, so the same in every language
    face_tap: str
    face_turn: str
    face_code: str
    see_title: str
    see_text: str
    refused_title: str
    refused_text: str
    shifts_title: str
    shifts_as_on: str  # {date}
    shift_on_time: str  # after "09:00-17:00", before the time
    shift_leave: str
    shift_out_inline: str  # the compact line (many shifts), with a space in front
    shift_out_line: str  # the small second line under the times
    shifts_more: str  # {count}, two or more left out
    shifts_more_one: str  # {count}, exactly one left out
    shift_rules: tuple[str, str]
    privacy_heading: str
    privacy_lead: str
    privacy_notice: str  # {days}
    privacy_rights: str
    offline_notice: str
    help_text: str
    privacy_address_label: str


ENGLISH = PosterTexts(
    title="Attendance at this gate",
    ways_heading="Punch in one of two ways",
    card_title="Card: hold your card to the camera",
    card_hold="Hold it still, about 20 cm from the camera.",
    card_photo="Then look at the camera: a photo is taken with every card punch.",
    face_title="Face: tap Punch with face, turn your head as the arrow shows",
    face_button="Punch\nwith face",
    face_tap="Tap the blue button.",
    face_turn="Turn your head as the arrow shows, then look straight.",
    face_code="If the screen asks, type your employee code.",
    see_title="See IN or OUT on the screen",
    see_text="Your name and the time are shown. That is all.",
    refused_title="NOT ACCEPTED? Go to the plant office.",
    refused_text="Do not try again and again. The office can see why.",
    shifts_title="Your shift times",
    shifts_as_on="Shift times as on {date}",
    shift_on_time=": on time until ",
    shift_leave=", leave from ",
    shift_out_inline=" OUT allowed until ",
    shift_out_line="OUT allowed until ",
    shifts_more="and {count} more shifts: ask the plant office",
    shifts_more_one="and {count} more shift: ask the plant office",
    shift_rules=(
        "One IN and one OUT per shift. After your OUT you cannot punch again in the same shift.",
        "Please visit the plant office if your shift is closed by mistake.",
    ),
    privacy_heading="About your face and the photo",
    privacy_lead="Pressing Punch with face means your face is checked.",
    privacy_notice=(
        "Face punch: your face is checked against an encrypted record. A photo is kept for "
        "{days} days only if the punch fails or you type your code. Card punch: a "
        "photo is kept for {days} days and checked automatically to see that a face "
        "is present."
    ),
    privacy_rights=(
        "Only the Super Admin can open a photo, and every view is recorded. Face data is never "
        "shared and never sent to any AI company. Your punch times are kept as attendance "
        "records, as the law requires."
    ),
    offline_notice=(
        "No internet? Your punch is saved on this attendance device in a locked form that only our "
        "server can open, and it is deleted from the device once it is sent. It is checked later; "
        "if something is wrong, the plant office will tell you."
    ),
    help_text="Need help? Ask the plant office.",
    privacy_address_label="Full privacy notice:",
)

MARATHI = PosterTexts(
    title="या गेटवरील हजेरी",
    ways_heading="दोनपैकी एका प्रकारे पंच करा",
    card_title="कार्ड: तुमचे कार्ड कॅमेऱ्यासमोर धरा",
    card_hold="ते स्थिर धरा, कॅमेऱ्यापासून सुमारे 20 सेमी अंतरावर.",
    card_photo="मग कॅमेऱ्याकडे पाहा: प्रत्येक कार्ड पंचसोबत एक फोटो घेतला जातो.",
    face_title="चेहरा: Punch with face दाबा, बाण दाखवेल तसे डोके वळवा",
    face_button="Punch\nwith face",
    face_tap="निळ्या बटणावर टॅप करा.",
    face_turn="बाण दाखवेल तसे डोके वळवा, मग सरळ पाहा.",
    face_code="स्क्रीनने मागितल्यास तुमचा कर्मचारी कोड टाका.",
    see_title="स्क्रीनवर IN किंवा OUT पाहा",
    see_text="तुमचे नाव आणि वेळ दिसते. एवढेच.",
    refused_title="NOT ACCEPTED दिसले? प्लांट ऑफिसमध्ये जा.",
    refused_text="पुन्हा पुन्हा प्रयत्न करू नका. ऑफिसला कारण दिसते.",
    shifts_title="तुमच्या शिफ्टच्या वेळा",
    shifts_as_on="शिफ्टच्या वेळा {date} प्रमाणे",
    shift_on_time=": वेळेवर येण्याची शेवटची वेळ ",
    shift_leave=", निघण्याची वेळ ",
    shift_out_inline=" OUT ची शेवटची वेळ ",
    shift_out_line="OUT ची शेवटची वेळ ",
    shifts_more="आणखी {count} शिफ्ट: प्लांट ऑफिसला विचारा",
    shifts_more_one="आणखी {count} शिफ्ट: प्लांट ऑफिसला विचारा",
    shift_rules=(
        "प्रत्येक शिफ्टमध्ये एक IN आणि एक OUT. OUT नंतर त्याच शिफ्टमध्ये पुन्हा पंच करता येत नाही.",
        "शिफ्ट चुकून बंद झाली असेल तर कृपया प्लांट ऑफिसला भेट द्या.",
    ),
    privacy_heading="तुमचा चेहरा आणि फोटो याबद्दल",
    privacy_lead="Punch with face दाबणे म्हणजे तुमचा चेहरा तपासला जातो.",
    privacy_notice=(
        "चेहऱ्याने पंच: तुमचा चेहरा एन्क्रिप्ट केलेल्या नोंदीशी तपासला जातो. पंच अयशस्वी "
        "झाल्यास किंवा तुम्ही तुमचा कोड टाकल्यास फोटो फक्त {days} दिवस ठेवला जातो. कार्डने "
        "पंच: फोटो {days} दिवस ठेवला जातो आणि त्यात चेहरा आहे का हे आपोआप तपासले जाते."
    ),
    privacy_rights=(
        "फोटो फक्त सुपर ॲडमिन उघडू शकतो आणि प्रत्येक वेळी पाहिल्याची नोंद होते. चेहऱ्याचा डेटा "
        "कधीही इतरांना दिला जात नाही आणि कोणत्याही AI कंपनीला पाठवला जात नाही. तुमच्या पंचच्या "
        "वेळा कायद्यानुसार हजेरीच्या नोंदी म्हणून ठेवल्या जातात."
    ),
    offline_notice=(
        "इंटरनेट नाही? तुमचा पंच या हजेरी उपकरणावर कुलूपबंद स्वरूपात साठवला जातो, जो फक्त आमचा "
        "सर्व्हर उघडू शकतो, आणि पाठवल्यावर उपकरणावरून हटवला जातो. तो नंतर तपासला जातो; काही चुकले "
        "असल्यास प्लांट ऑफिस तुम्हाला सांगेल."
    ),
    help_text="मदत हवी आहे? प्लांट ऑफिसला विचारा.",
    privacy_address_label="संपूर्ण गोपनीयता सूचना:",
)

HINDI = PosterTexts(
    title="इस गेट पर हाज़िरी",
    ways_heading="दो में से किसी एक तरीके से पंच करें",
    card_title="कार्ड: अपना कार्ड कैमरे के सामने रखें",
    card_hold="उसे स्थिर रखें, कैमरे से लगभग 20 सेमी दूर।",
    card_photo="फिर कैमरे की ओर देखें: हर कार्ड पंच के साथ एक तस्वीर ली जाती है।",
    face_title="चेहरा: Punch with face दबाएँ, तीर जैसा दिखाए वैसे सिर घुमाएँ",
    face_button="Punch\nwith face",
    face_tap="नीले बटन पर टैप करें।",
    face_turn="तीर जैसा दिखाए वैसे सिर घुमाएँ, फिर सीधे देखें।",
    face_code="स्क्रीन माँगे तो अपना कर्मचारी कोड डालें।",
    see_title="स्क्रीन पर IN या OUT देखें",
    see_text="आपका नाम और समय दिखता है। बस इतना ही।",
    refused_title="NOT ACCEPTED दिखे? प्लांट ऑफ़िस जाएँ।",
    refused_text="बार-बार कोशिश न करें। ऑफ़िस में कारण दिखता है।",
    shifts_title="आपकी शिफ़्ट के समय",
    shifts_as_on="शिफ़्ट के समय {date} के अनुसार",
    shift_on_time=": समय पर आने का अंतिम समय ",
    shift_leave=", जाने का समय ",
    shift_out_inline=" OUT का अंतिम समय ",
    shift_out_line="OUT का अंतिम समय ",
    shifts_more="{count} और शिफ़्ट: प्लांट ऑफ़िस से पूछें",
    shifts_more_one="{count} और शिफ़्ट: प्लांट ऑफ़िस से पूछें",
    shift_rules=(
        "हर शिफ़्ट में एक IN और एक OUT। OUT के बाद उसी शिफ़्ट में दोबारा पंच नहीं हो सकता।",
        "अगर शिफ़्ट गलती से बंद हो गई हो तो कृपया प्लांट ऑफ़िस आएँ।",
    ),
    privacy_heading="आपके चेहरे और तस्वीर के बारे में",
    privacy_lead="Punch with face दबाने का मतलब है कि आपका चेहरा जाँचा जाता है।",
    privacy_notice=(
        "चेहरे से पंच: आपका चेहरा एन्क्रिप्ट किए हुए रिकॉर्ड से मिलाया जाता है। तस्वीर केवल तब "
        "{days} दिन रखी जाती है जब पंच विफल हो या आप अपना कोड डालें। कार्ड से पंच: तस्वीर {days} "
        "दिन रखी जाती है और अपने आप जाँची जाती है कि उसमें चेहरा है या नहीं।"
    ),
    privacy_rights=(
        "तस्वीर केवल सुपर एडमिन खोल सकता है और हर बार देखने का रिकॉर्ड रखा जाता है। चेहरे का डेटा "
        "कभी साझा नहीं किया जाता और किसी AI कंपनी को नहीं भेजा जाता। आपके पंच के समय कानून के "
        "अनुसार हाज़िरी के रिकॉर्ड के रूप में रखे जाते हैं।"
    ),
    offline_notice=(
        "इंटरनेट नहीं है? आपका पंच इस हाज़िरी उपकरण पर बंद रूप में सुरक्षित रहता है, जिसे केवल हमारा "
        "सर्वर खोल सकता है, और भेजे जाने के बाद उपकरण से मिटा दिया जाता है। उसकी जाँच बाद में होती है; "
        "कुछ गड़बड़ हो तो प्लांट ऑफ़िस आपको बताएगा।"
    ),
    help_text="मदद चाहिए? प्लांट ऑफ़िस से पूछें।",
    privacy_address_label="पूरी गोपनीयता सूचना:",
)

_TEXTS_BY_LANGUAGE = {"en": ENGLISH, "mr": MARATHI, "hi": HINDI}


def poster_texts(language: str) -> PosterTexts:
    return _TEXTS_BY_LANGUAGE[language]
