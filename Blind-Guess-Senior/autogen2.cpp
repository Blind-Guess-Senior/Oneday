#include <iostream>
#include <fstream>
#include <sstream>
#include <vector>
#include <string>
#include <algorithm>
#include <cctype>
#include <filesystem>

namespace fs = std::filesystem;

// 辅助函数：去除字符串首尾空格
std::string trim(const std::string& str) {
    size_t start = str.find_first_not_of(" \t\n\r");
    if (start == std::string::npos) return "";
    size_t end = str.find_last_not_of(" \t\n\r");
    return str.substr(start, end - start + 1);
}

// 辅助函数：检查字符串是否以特定前缀开头
bool startsWith(const std::string& str, const std::string& prefix) {
    return str.size() >= prefix.size() && str.compare(0, prefix.size(), prefix) == 0;
}

// 判断是否为中文字符
bool isChineseChar(const std::string& s) {
    if (s.empty()) return false;
    // 简单判断：中文字符通常占用3个字节（UTF-8）
    // 更准确的方法需要完整的UTF-8处理，这里简化处理
    return s.size() >= 3 && !std::isalnum(static_cast<unsigned char>(s[0]));
}

// 判断字符串是否可能为中国作者名（2-3个中文字符）
bool isPossibleChineseAuthor(const std::string& s) {
    if (s.size() < 2 || s.size() > 9) return false; // 中文字符串长度（UTF-8字节数）

    // 简单检查是否包含非ASCII字符（可能是中文）
    for (char c : s) {
        if (static_cast<unsigned char>(c) > 127) {
            return true;
        }
    }
    return false;
}

// 主处理函数
void processMarkdownFile(const std::string& inputFilePath) {
    std::ifstream inputFile(inputFilePath);
    if (!inputFile.is_open()) {
        std::cerr << "无法打开输入文件: " << inputFilePath << std::endl;
        return;
    }

    std::string line;
    while (std::getline(inputFile, line)) {
        line = trim(line);

        // 检查是否为复选框行
        if (!(startsWith(line, "- [ ] ") || startsWith(line, "- [x] "))) {
            continue;
        }

        // 解析复选框状态
        bool isChecked = (line[3] == 'x');
        std::string content = trim(line.substr(6)); // 跳过"- [x] "或"- [ ] "

        // 分割内容
        std::vector<std::string> parts;
        std::istringstream iss(content);
        std::string token;
        while (iss >> token) {
            parts.push_back(token);
        }

        if (parts.empty()) continue;

        // 提取标签（以#开头的部分）
        std::vector<std::string> tags;
        std::vector<std::string> nonTagParts;
        for (const auto& part : parts) {
            if (startsWith(part, "#")) {
                tags.push_back(part);
            } else {
                nonTagParts.push_back(part);
            }
        }

        // 解析名称、国家和作者
        std::string name, country, author;

        if (nonTagParts.size() == 1) {
            // 只有名称
            name = nonTagParts[0];
        } else if (nonTagParts.size() == 2) {
            // 名称 + 国家/作者
            name = nonTagParts[0];
            std::string secondPart = nonTagParts[1];

            // 检查是否可能是中国作者（2-3个中文字符）
            if (isPossibleChineseAuthor(secondPart)) {
                author = secondPart;
                country = "中";
            } else {
                country = secondPart;
            }
        } else if (nonTagParts.size() >= 3) {
            // 名称 + 国家 + 作者 + 可能的多余部分
            name = nonTagParts[0];
            country = nonTagParts[1];
            author = nonTagParts[2];

            // 检查是否可能是中国作者特例（国家位置实际上是作者）
            if (isPossibleChineseAuthor(country) && !isPossibleChineseAuthor(author)) {
                // 可能是误判，交换国家和作者
                author = country;
                country = "中";
            }
        }

        // 生成元数据
        std::ostringstream metadata;
        metadata << "---\n";
        metadata << "status: " << (isChecked ? "已完成" : "未完成") << "\n";
        if (!country.empty()) metadata << "country: " << country << "\n";
        if (!author.empty()) metadata << "author: " << author << "\n";
        if (!tags.empty()) {
            metadata << "tags:\n";
            for (const auto& tag : tags) {
                metadata << "  - " << tag.substr(1) << "\n"; // 去掉#号
            }
        }
        metadata << "---\n\n";
        metadata << "# " << name << "\n";

        // 创建输出文件
        std::string fileName = name + ".md";
        std::ofstream outputFile(fileName);
        if (!outputFile.is_open()) {
            std::cerr << "无法创建文件: " << fileName << std::endl;
            continue;
        }

        outputFile << metadata.str();
        outputFile.close();
        std::cout << "已创建文件: " << fileName << std::endl;
    }

    inputFile.close();
}

int main(int argc, char* argv[]) {
    if (argc != 2) {
        std::cerr << "用法: " << argv[0] << " <markdown文件路径>" << std::endl;
        return 1;
    }

    std::string inputFilePath = argv[1];
    processMarkdownFile(inputFilePath);
    return 0;
}
