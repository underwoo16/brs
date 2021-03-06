sub Main()
    ' mock formatJSON
    _brs_.mockfunction("formatJson", (function(json as object, flags=0 as integer) as dynamic
        return "{fake:'json'}"
    end function))

    ' call the mocked function
    print formatJson({}) ' => {fake:'json'}

    ' mock a function from this file
    _brs_.mockFunction("mocKMe", function()
        return "your wish is my command"
    end function)

    print mockMe() ' => "your wish is my command"

    ' Local vs function scope
    print foo() ' => Named foo

    foo = function()
        return "--inline foo--"
    end function

    print foo() ' => "--inline foo--"

    _brs_.mockFunction("foo", function()
        return "mOcKeD fOo"
    end function)

    print foo() ' => "--inline foo--"
end sub

function mockMe()
    return "oops!"
end function

function foo()
    return "Named foo"
end function
