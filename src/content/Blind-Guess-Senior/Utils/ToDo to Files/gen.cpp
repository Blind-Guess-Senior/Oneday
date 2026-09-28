#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <regex>
#include <codecvt> // For std::wstring_convert and std::codecvt_utf8
#include <locale>  // For std::locale
#include <sstream> // For std::wistringstream
#include <ctime>   // For std::time_t and std::to_string for fallback filename

// Function to convert UTF-8 string to wstring
std::wstring utf8_to_wstring(const std::string& str) {
    static std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
    return converter.from_bytes(str);
}

// Function to convert wstring to UTF-8 string
std::string wstring_to_utf8(const std::wstring& wstr) {
    static std::wstring_convert<std::codecvt_utf8<wchar_t>> converter;
    return converter.to_bytes(wstr);
}

// Function to check if a wide character is a Chinese character
bool is_chinese_char(wchar_t wc) {
    // Basic range for CJK Unified Ideographs
    // This might not cover all possible Chinese characters, but covers most common ones
    return (wc >= 0x4E00 && wc <= 0x9FFF);
}

// Function to clean string for filename (remove non-alphanumeric, non-Chinese, non-underscore, non-hyphen)
std::string clean_filename(const std::string& input_str) {
    std::wstring wstr = utf8_to_wstring(input_str);
    std::wstring cleaned_wstr;
    for (wchar_t wc : wstr) {
        if (is_chinese_char(wc) || std::iswalnum(wc) || wc == L'_' || wc == L'-') {
            cleaned_wstr += wc;
        }
    }
    // Handle potential empty filename after cleaning
    if (cleaned_wstr.empty()) {
        return "untitled"; // Provide a default name if cleaning results in empty string
    }
    return wstring_to_utf8(cleaned_wstr);
}

struct ParsedLine {
    std::string status;
    std::string title;
    std::string country;
    std::string author;
    std::vector<std::string> tags;
};

// Function to parse a single line
bool parse_line(const std::string& line, ParsedLine& parsed_data) {
    // Regex to match the checkbox, title, country/author, and tags
    // Group 1: checkbox status (e.g., " ", "x", "X")
    // Group 2: remaining content for title, country/author, tags
    std::regex line_regex_str(R"(^\s*-\s*\[([ xX])\]\s*(.*)$)");
    std::smatch match_line;

    if (!std::regex_search(line, match_line, line_regex_str)) {
        // Not a checkbox line, skip
        return false;
    }

    // Determine status
    std::string checkbox_status = match_line[1].str();
    if (checkbox_status == "x" || checkbox_status == "X") {
        parsed_data.status = "已完成";
    } else {
        parsed_data.status = "未完成";
    }

    std::string content = match_line[2].str();

    // Split tags first
    std::regex tag_regex_str(R"(#([^\s#]+))"); // Matches #tagname (tagname cannot contain space or #)
    auto tags_begin = std::sregex_iterator(content.begin(), content.end(), tag_regex_str);
    auto tags_end = std::sregex_iterator();

    std::string main_info = content;
    for (std::sregex_iterator i = tags_begin; i != tags_end; ++i) {
        parsed_data.tags.push_back(i->str(1)); // Capture the tag name without '#'
        // Remove the tag from main_info to process title, country, author
        size_t pos = main_info.find(i->str(0));
        if (pos != std::string::npos) {
            main_info.erase(pos, i->str(0).length());
        }
    }

    // Clean up extra spaces after tag removal
    main_info = std::regex_replace(main_info, std::regex(R"(\s+)"), " ");
    main_info = std::regex_replace(main_info, std::regex(R"(^\s+|\s+$)"), "");

    // Now parse title, country, author from main_info
    std::wistringstream wiss(utf8_to_wstring(main_info));
    std::wstring segment;
    std::vector<std::wstring> segments_w;
    while (wiss >> segment) {
        segments_w.push_back(segment);
    }

    if (segments_w.empty()) {
        std::cerr << "Error: No title found in line: " << line << std::endl;
        return false;
    }

    parsed_data.title = wstring_to_utf8(segments_w[0]);

    if (segments_w.size() == 2) {
        // Only two segments: title, and (country or author)
        // Rule: if second segment length is 2 or 3, it's author (no country)
        // Otherwise, it's country (no author)
        if (segments_w[1].length() >= 2 && segments_w[1].length() <= 3) {
            parsed_data.author = wstring_to_utf8(segments_w[1]);
            parsed_data.country = "中"; // Set country to "中" if only author is present
            std::cout << "Info: Book '" << parsed_data.title << "' assumed to be from '中' (China) as no country was specified.\n";
        } else {
            parsed_data.country = wstring_to_utf8(segments_w[1]);
        }
    } else if (segments_w.size() >= 3) {
        // Three or more segments: title, country, author
        parsed_data.country = wstring_to_utf8(segments_w[1]);
        parsed_data.author = wstring_to_utf8(segments_w[2]);
    }
    // If only one segment, only title is present, country and author remain empty

    return true;
}

// Function to generate Markdown file
void generate_markdown_file(const ParsedLine& data) {
    std::string filename = clean_filename(data.title);
    if (filename.empty() || filename == "untitled") {
         filename = "generated_" + std::to_string(std::time(nullptr)); // Fallback filename
    }
    filename += ".md";

    std::ofstream outfile(filename);

    if (!outfile.is_open()) {
        std::cerr << "Error: Could not create file " << filename << std::endl;
        return;
    }

    outfile << "---\n";
    outfile << "status: " << data.status << "\n";
    if (!data.country.empty()) {
        outfile << "country: " << data.country << "\n";
    }
    if (!data.author.empty()) {
        outfile << "author: " << data.author << "\n";
    }
    outfile << "category: [书籍]\n"; // Changed to a list
    if (!data.tags.empty()) {
        outfile << "tags: [";
        for (size_t i = 0; i < data.tags.size(); ++i) {
            outfile << data.tags[i];
            if (i < data.tags.size() - 1) {
                outfile << ", ";
            }
        }
        outfile << "]\n";
    }
    outfile << "---\n";

    outfile.close();
    std::cout << "Generated file: " << filename << std::endl;
}

int main() {
    // Attempt to set the global locale to the user's default locale.
    // This is generally safer than hardcoding specific locale names.
    try {
        std::locale::global(std::locale(""));
        // Imbue wcout and wcerr for wide character output,
        // so warning messages can correctly display Chinese characters.
        std::wcout.imbue(std::locale(""));
        std::wcerr.imbue(std::locale(""));
    } catch (const std::runtime_error& e) {
        std::cerr << "Warning: Failed to set global locale to system default: " << e.what() << std::endl;
        std::cerr << "         Program will proceed, but character encoding issues might occur with console output.\n";
    }

    std::cout << "请输入要处理的 Markdown 文件路径: ";
    std::string input_filepath;
    std::getline(std::cin, input_filepath);

    std::ifstream infile(input_filepath);
    if (!infile.is_open()) {
        std::cerr << "错误: 无法打开文件 " << input_filepath << std::endl;
        return 1;
    }

    std::string current_line;
    int line_num = 0;

    while (std::getline(infile, current_line)) {
        line_num++;
        ParsedLine parsed_data;
        // Clear previous data to ensure no leftover values in case of parse failure
        parsed_data = {}; 
        if (parse_line(current_line, parsed_data)) {
            generate_markdown_file(parsed_data);
        } else {
            if (current_line.find("- [") == std::string::npos) {
                // Not a checkbox line, silently skip as per requirement
            } else {
                std::cerr << "Warning: Skipping line " << line_num << " due to parsing error: " << current_line << std::endl;
            }
        }
    }

    infile.close();
    std::cout << "所有符合条件的行已处理完毕。\n";

    return 0;
}