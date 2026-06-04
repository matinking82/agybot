import { Keyboard } from "grammy";

export const cancelOptions = {
    cancel: "انصراف ❌",
}

export const cancelKeyboard = () => {
    let kb = new Keyboard();

    for (let key in cancelOptions) {
        kb.text(cancelOptions[key]).row();
    }

    kb.resize_keyboard = true;

    return kb;
};

export const menuOptions = {
    profile: "پروفایل 👤",
}

export const menuKeyboard = () => {
    let kb = new Keyboard();

    for (let key in menuOptions) {
        kb.text(menuOptions[key]).row();
    }

    kb.resize_keyboard = true;

    return kb;
};